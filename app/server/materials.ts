import {z} from 'zod';
import {Archives} from './archives.ts';
import {assertAdmin,authGuard} from './credentials.ts';
import {command,expectedVersion,requestId,type Source} from './commands.ts';
import {Failure,digest,now,uid,type Actor,type Env} from './types.ts';

export const MAX_MATERIAL_BYTES=100_000_000;
const filename=z.string().trim().min(1).max(240).refine(n=>!/[\x00-\x1f\x7f/\\]/.test(n)&&!['.','..'].includes(n),'文件名不能包含路径或控制字符');
const description=z.string().trim().max(1000).default('');
export const materialPrepareInput=z.object({archive_id:z.uuid(),name:filename,description,mime_type:z.string().max(120).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/).default('application/octet-stream'),byte_size:z.number().int().min(1).max(MAX_MATERIAL_BYTES),sha256:z.string().regex(/^[0-9a-f]{64}$/)}).strict();
export const materialListInput=z.object({archive_id:z.uuid(),deleted:z.union([z.boolean(),z.enum(['true','false']).transform(v=>v==='true')]).default(false),before:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)}).strict();
export const materialUpdateInput=z.object({id:z.uuid(),expected_version:expectedVersion,name:filename,description,request_id:requestId}).strict();
export const materialStateInput=z.object({id:z.uuid(),expected_version:expectedVersion,request_id:requestId}).strict();
export const materialCancelInput=z.object({id:z.uuid(),request_id:requestId}).strict();
export const materialQuotaInput=z.object({archive_id:z.uuid(),expected_version:expectedVersion,limit_bytes:z.number().int().min(100_000_000).max(1_000_000_000_000),request_id:requestId}).strict();
type MaterialRow={id:string;archive_id:string;owner_id:string;source:Source;name:string;description:string;mime_type:string;byte_size:number;sha256:string;object_key:string;state:'pending'|'uploading'|'ready'|'cancelled'|'expired'|'purging'|'purged';deleted:number;version:number;created_at:string;updated_at:string;ready_at:string|null;ticket_hash:string;ticket_expires_at:string;credential_id:string;auth_epoch:number;upload_claim:string|null;lease_until:string|null;owner_name?:string};
export type MaterialInfo={id:string;archive_id:string;owner_id:string;owner_name:string;name:string;description:string;mime_type:string;byte_size:number;sha256:string;state:string;deleted:boolean;version:number;created_at:string;updated_at:string;editable:boolean;download_url:string;preview_url:string|null;reference_url:string};
export type MaterialCapacity={limit_bytes:number;used_bytes:number;reserved_bytes:number;available_bytes:number;version:number;count:number;default_bytes:number;max_file_bytes:number};
const stored="state IN ('ready','purging')";
const reservation="(state='pending' AND ticket_expires_at>?) OR (state='uploading' AND (ticket_expires_at>? OR lease_until>?))";
const previewTypes=new Set(['image/png','image/jpeg','image/webp','image/gif','application/pdf']);
const guardError=(e:unknown)=>{if(String(e).includes('CHECK constraint'))throw new Failure(409,'MATERIAL_PRECONDITION_CHANGED','容量、账号或档案状态已变化，请重新读取后重试');throw e;};

// Materials owns the complete upload reservation, private object and lifecycle boundary.
// The image service retains its stricter immutable observation/history contract.
export class Materials{
 readonly archives:Archives;
 constructor(readonly env:Env,readonly actor:Actor,readonly source:Source){this.archives=new Archives(env,actor,source);}
 stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 private subjectGuard(id:string,key:string){return this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archives WHERE id=? AND closed=0 AND deleted=0) THEN 1 ELSE 0 END)',key,id);}
 private ownerGuard(id:string,version:number,key:string){return this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM materials WHERE id=? AND version=? AND state='ready' AND (owner_id=? OR EXISTS(SELECT 1 FROM members WHERE id=? AND role='admin'))) THEN 1 ELSE 0 END)",key,id,version,this.actor.id,this.actor.id);}
 private async row(id:string){z.uuid().parse(id);const row=await this.stmt('SELECT f.*,m.name owner_name FROM materials f JOIN members m ON m.id=f.owner_id WHERE f.id=?',id).first<MaterialRow>();if(!row)throw new Failure(404,'MATERIAL_NOT_FOUND','材料不存在或无权读取');return row;}
 private info(row:MaterialRow,archive:{type:'person'|'org';closed:boolean;deleted:boolean}):MaterialInfo{return {id:row.id,archive_id:row.archive_id,owner_id:row.owner_id,owner_name:row.owner_name??this.actor.name,name:row.name,description:row.description,mime_type:row.mime_type,byte_size:row.byte_size,sha256:row.sha256,state:row.state,deleted:!!row.deleted,version:row.version,created_at:row.ready_at??row.created_at,updated_at:row.updated_at,editable:row.state==='ready'&&!archive.closed&&!archive.deleted&&(row.owner_id===this.actor.id||this.actor.role==='admin'),download_url:`${this.env.APP_ORIGIN}/materials/${row.id}/content`,preview_url:previewTypes.has(row.mime_type)?`${this.env.APP_ORIGIN}/materials/${row.id}/content?preview=1`:null,reference_url:`${this.archives.url({id:row.archive_id,type:archive.type})}&material=${row.id}`};}
 async capacity(id:string):Promise<MaterialCapacity>{
  const archive=await this.archives.get(id),at=now(),quota=await this.stmt('SELECT material_quota_bytes,material_quota_version FROM archives WHERE id=?',id).first<{material_quota_bytes:number|null;material_quota_version:number}>();
  const totals=await this.stmt(`SELECT coalesce(sum(CASE WHEN ${stored} THEN byte_size ELSE 0 END),0) used_bytes,coalesce(sum(CASE WHEN ${reservation} THEN byte_size ELSE 0 END),0) reserved_bytes,coalesce(sum(CASE WHEN state='ready' AND deleted=0 THEN 1 ELSE 0 END),0) count FROM materials WHERE archive_id=?`,at,at,at,id).first<{used_bytes:number;reserved_bytes:number;count:number}>();
  const defaultBytes=archive.type==='person'?100_000_000:200_000_000,limit=quota!.material_quota_bytes??defaultBytes;
  return {...totals!,limit_bytes:limit,available_bytes:Math.max(0,limit-totals!.used_bytes-totals!.reserved_bytes),version:quota!.material_quota_version,default_bytes:defaultBytes,max_file_bytes:MAX_MATERIAL_BYTES};
 }
 async list(input:unknown){
  const a=materialListInput.parse(input),archive=await this.archives.get(a.archive_id),args:unknown[]=[a.archive_id,a.deleted?1:0];
  const author=a.deleted?' AND (f.owner_id=? OR ?=\'admin\')':'';if(a.deleted)args.push(this.actor.id,this.actor.role);
  let cursor='';if(a.before){const before=await this.row(a.before);if(before.archive_id!==a.archive_id)throw new Failure(400,'INVALID_CURSOR','分页位置不属于该档案');cursor=' AND (f.created_at<? OR (f.created_at=? AND f.id<?))';args.push(before.created_at,before.created_at,before.id);}
  const rows=await this.stmt(`SELECT f.*,m.name owner_name FROM materials f JOIN members m ON m.id=f.owner_id WHERE f.archive_id=? AND f.deleted=? AND f.state IN ('ready'${a.deleted?",'purging'":''})${author}${cursor} ORDER BY f.created_at DESC,f.id DESC LIMIT ?`,...args,a.limit+1).all<MaterialRow>();
  return {materials:rows.results.slice(0,a.limit).map(row=>this.info(row,archive)),capacity:await this.capacity(a.archive_id),next_cursor:rows.results.length>a.limit?rows.results[a.limit-1].id:null};
 }
 async get(id:string){const row=await this.row(id),archive=await this.archives.get(row.archive_id);if(!['ready','purging'].includes(row.state)||(row.deleted&&row.owner_id!==this.actor.id&&this.actor.role!=='admin'))throw new Failure(404,'MATERIAL_NOT_FOUND','材料不存在或无权读取');return {material:this.info(row,archive)};}
 async prepare(input:unknown){
  const a=materialPrepareInput.parse(input);await this.archives.get(a.archive_id,undefined,true);const capacity=await this.capacity(a.archive_id);if(a.byte_size>capacity.available_bytes)throw new Failure(409,'MATERIAL_CAPACITY_EXCEEDED','剩余材料容量不足，请清理材料或联系管理员扩容');
  const id=uid(),secret=uid()+uid(),at=now(),expires=new Date(Date.now()+30*60000).toISOString(),key=uid();
  await this.env.DB.batch([authGuard(this.env,this.actor,key),this.subjectGuard(a.archive_id,key+':archive'),
   this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN (SELECT coalesce(sum(byte_size),0) FROM materials WHERE archive_id=? AND (${stored} OR ${reservation}))+? <= (SELECT coalesce(material_quota_bytes,CASE WHEN type='person' THEN 100000000 ELSE 200000000 END) FROM archives WHERE id=?) AND (SELECT count(*) FROM materials WHERE owner_id=? AND (${reservation}))<50 THEN 1 ELSE 0 END)`,key+':quota',a.archive_id,at,at,at,a.byte_size,a.archive_id,this.actor.id,at,at,at),
   this.stmt('INSERT INTO materials(id,archive_id,owner_id,source,name,description,mime_type,byte_size,sha256,object_key,created_at,updated_at,ticket_hash,ticket_expires_at,credential_id,auth_epoch) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,a.archive_id,this.actor.id,this.source,a.name,a.description,a.mime_type.toLowerCase(),a.byte_size,a.sha256,'materials/'+id,at,at,await digest(secret),expires,this.actor.credential_id,this.actor.auth_epoch),
   this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?,?)',key,key+':archive',key+':quota'),
  ]).catch(guardError);
  return {upload_id:id,method:'PUT',url:`${this.env.APP_ORIGIN}/material-uploads/${id}`,headers:{'Content-Type':a.mime_type.toLowerCase(),'X-Upload-Ticket':secret},expires_at:expires,byte_size:a.byte_size,sha256:a.sha256};
 }
 async status(id:string){const row=await this.row(id);if(row.owner_id!==this.actor.id)throw new Failure(404,'UPLOAD_NOT_FOUND','上传不存在或不属于本人');const archive=await this.archives.get(row.archive_id);return {upload_id:id,state:row.state==='pending'&&row.ticket_expires_at<=now()?'expired':row.state,expires_at:row.ticket_expires_at,material:row.state==='ready'?this.info(row,archive):null};}
 static async receive(env:Env,id:string,request:Request){
  z.uuid().parse(id);const ticket=request.headers.get('X-Upload-Ticket');if(!ticket||ticket.length>100)throw new Failure(401,'UPLOAD_TICKET_INVALID','缺少有效上传票据');
  const row=await env.DB.prepare('SELECT * FROM materials WHERE id=? AND ticket_hash=?').bind(id,await digest(ticket)).first<MaterialRow>();if(!row)throw new Failure(401,'UPLOAD_TICKET_INVALID','上传票据不匹配');
  const actor=await env.DB.prepare("SELECT m.*,c.id credential_id,c.kind credential_kind FROM members m JOIN credentials c ON c.member_id=m.id WHERE m.id=? AND m.auth_epoch=? AND m.frozen=0 AND m.must_change_password=0 AND c.id=? AND c.auth_epoch=m.auth_epoch AND c.revoked_at IS NULL AND c.expires_at>?").bind(row.owner_id,row.auth_epoch,row.credential_id,now()).first<Actor>();if(!actor)throw new Failure(401,'UPLOAD_AUTH_EXPIRED','账号或原凭证已失效，请重新登录后上传');
  return new Materials(env,actor,row.source).upload(row,request);
 }
 private async upload(row:MaterialRow,request:Request){
  if(row.state==='ready')return {upload_id:row.id,state:'ready'};
  if(row.ticket_expires_at<=now())throw new Failure(410,'UPLOAD_EXPIRED','上传票据已过期，请重新准备');
  if(!['pending','uploading'].includes(row.state))throw new Failure(409,'UPLOAD_UNAVAILABLE','上传已取消或状态已变化');
  if(row.state==='uploading'&&row.lease_until!>now())throw new Failure(409,'UPLOAD_IN_PROGRESS','文件正在上传，请稍后查询状态');
  if(Number(request.headers.get('Content-Length'))!==row.byte_size||request.headers.get('Content-Type')?.split(';')[0]!==row.mime_type||!request.body)throw new Failure(400,'UPLOAD_METADATA_MISMATCH','上传类型或字节数与准备信息不一致');
  await this.archives.get(row.archive_id,undefined,true);const key=uid(),claim=uid(),at=now(),lease=new Date(Date.now()+30*60000).toISOString();
  await this.env.DB.batch([authGuard(this.env,this.actor,key),this.subjectGuard(row.archive_id,key+':archive'),
   this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM materials WHERE id=? AND ticket_expires_at>? AND (state='pending' OR (state='uploading' AND lease_until<=?))) THEN 1 ELSE 0 END)",key+':claim',row.id,at,at),
   this.stmt("UPDATE materials SET state='uploading',upload_claim=?,lease_until=? WHERE id=?",claim,lease,row.id),this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?,?)',key,key+':archive',key+':claim'),
  ]).catch(guardError);
  try{
   // Preserve the request's known-length stream; R2 verifies the fixed SHA-256 without
   // buffering a 100 MB file in the Worker. Retries can only write these same bytes.
   const object=await this.env.IMAGES.put(row.object_key,request.body,{storageClass:'Standard',sha256:row.sha256,httpMetadata:{contentType:row.mime_type}});
   if(!object||object.size!==row.byte_size)throw new Failure(400,'MATERIAL_CONTENT_MISMATCH','文件实际大小与准备信息不一致');
   const ready=now();await this.env.DB.batch([authGuard(this.env,this.actor,key),this.subjectGuard(row.archive_id,key+':archive'),
    this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM materials WHERE id=? AND state='uploading' AND upload_claim=? AND ticket_expires_at>? AND lease_until>?) THEN 1 ELSE 0 END)",key+':finish',row.id,claim,ready,ready),
    this.stmt("UPDATE materials SET state='ready',ready_at=?,updated_at=?,upload_claim=NULL,lease_until=NULL WHERE id=?",ready,ready,row.id),
    this.stmt('UPDATE archives SET version=version+1,updated_at=? WHERE id=?',ready,row.archive_id),this.archives.event(row.archive_id,'material.uploaded',null,{material_id:row.id},ready),
    this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?,?)',key,key+':archive',key+':finish'),
   ]).catch(guardError);return {upload_id:row.id,state:'ready'};
  }finally{
   await this.stmt("UPDATE materials SET state='pending',upload_claim=NULL,lease_until=NULL WHERE id=? AND state='uploading' AND upload_claim=?",row.id,claim).run().catch(()=>{});
   // If an exceptionally slow write finishes after cleanup/cancellation, remove its
   // late object too. Never delete while a newer valid attempt or ready file owns it.
   const current=await this.stmt('SELECT state FROM materials WHERE id=?',row.id).first<{state:string}>().catch(()=>null);
   if(current&&['purged','expired','cancelled','purging'].includes(current.state))await this.env.IMAGES.delete(row.object_key).catch(()=>{});
  }
 }
 async cancel(input:unknown){const a=materialCancelInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'material.cancel',parameters:a},async()=>{const row=await this.row(a.id);if(row.owner_id!==this.actor.id)throw new Failure(404,'UPLOAD_NOT_FOUND','上传不存在或不属于本人');await this.archives.get(row.archive_id);if(row.state==='uploading'&&row.lease_until!>now())throw new Failure(409,'UPLOAD_IN_PROGRESS','上传尚在进行，请等待结束后重试');if(!['pending','expired','cancelled'].includes(row.state))throw new Failure(409,'UPLOAD_UNAVAILABLE','材料已经完成，请通过材料列表删除');const key=uid();return {result:{id:a.id,state:'cancelled',changed:row.state!=='cancelled'},statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM materials WHERE id=? AND owner_id=? AND state IN ('pending','expired','cancelled')) THEN 1 ELSE 0 END)",key,a.id,this.actor.id),this.stmt("UPDATE materials SET state='cancelled' WHERE id=?",a.id),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};});}
 private async writable(id:string,version:number){const row=await this.row(id);await this.archives.get(row.archive_id,undefined,true);if(row.owner_id!==this.actor.id&&this.actor.role!=='admin')throw new Failure(403,'MATERIAL_OWNER_REQUIRED','仅上传者或管理员可维护材料');if(row.state!=='ready')throw new Failure(409,'MATERIAL_UNAVAILABLE','材料未就绪或正在清除');if(row.version!==version)throw new Failure(409,'VERSION_CONFLICT','材料已更新，请重新读取后核对');return row;}
 private mutations(row:MaterialRow,kind:string,at:string,key:string){return [this.subjectGuard(row.archive_id,key+':archive'),this.ownerGuard(row.id,row.version,key+':owner'),this.stmt('UPDATE archives SET version=version+1,updated_at=? WHERE id=?',at,row.archive_id),this.archives.event(row.archive_id,kind,null,{material_id:row.id},at)];}
 private cleanupGuards(key:string){return this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key+':archive',key+':owner');}
 async update(input:unknown){const a=materialUpdateInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'material.update',parameters:a},async()=>{const row=await this.writable(a.id,a.expected_version);if(row.deleted)throw new Failure(409,'MATERIAL_DELETED','请先恢复材料再修改');const changed=row.name!==a.name||row.description!==a.description,key=uid(),at=now();return {result:{id:a.id,version:row.version+(changed?1:0),changed},statements:changed?[...this.mutations(row,'material.updated',at,key),this.stmt('UPDATE materials SET name=?,description=?,version=version+1,updated_at=? WHERE id=?',a.name,a.description,at,row.id),this.cleanupGuards(key)]:[this.subjectGuard(row.archive_id,key+':archive'),this.ownerGuard(row.id,row.version,key+':owner'),this.cleanupGuards(key)]};});}
 async setDeleted(input:unknown,deleted:boolean){const a=materialStateInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:deleted?'material.delete':'material.restore',parameters:a},async()=>{const row=await this.writable(a.id,a.expected_version),changed=!!row.deleted!==deleted,key=uid(),at=now();return {result:{id:a.id,version:row.version+(changed?1:0),deleted,changed},statements:changed?[...this.mutations(row,deleted?'material.deleted':'material.restored',at,key),this.stmt('UPDATE materials SET deleted=?,deleted_at=?,version=version+1,updated_at=? WHERE id=?',deleted?1:0,deleted?at:null,at,row.id),this.cleanupGuards(key)]:[this.subjectGuard(row.archive_id,key+':archive'),this.ownerGuard(row.id,row.version,key+':owner'),this.cleanupGuards(key)]};});}
 async purge(input:unknown){const a=materialStateInput.parse(input),result=await command(this.env,this.actor,{requestId:a.request_id,operation:'material.purge',parameters:a},async()=>{const row=await this.writable(a.id,a.expected_version);if(!row.deleted)throw new Failure(409,'MATERIAL_NOT_DELETED','请先将材料移入回收站');const key=uid(),at=now();return {result:{id:a.id,changed:true},statements:[...this.mutations(row,'material.purged',at,key),this.stmt("UPDATE materials SET state='purging',version=version+1,updated_at=? WHERE id=?",at,row.id),this.cleanupGuards(key)]};});
  const row=await this.row(a.id);await this.archives.get(row.archive_id);if(row.owner_id!==this.actor.id&&this.actor.role!=='admin')throw new Failure(403,'MATERIAL_OWNER_REQUIRED','仅上传者或管理员可清除材料');await purgeObject(this.env,row).catch(()=>{});return {...result,state:(await this.row(a.id)).state};
 }
 async setQuota(input:unknown){const a=materialQuotaInput.parse(input);assertAdmin(this.actor);return command(this.env,this.actor,{requestId:a.request_id,operation:'material.quota',parameters:a,requireAdmin:true},async()=>{await this.archives.get(a.archive_id,undefined,true);const old=await this.capacity(a.archive_id);if(a.expected_version!==old.version)throw new Failure(409,'VERSION_CONFLICT','容量设置已更新，请重新读取');if(a.limit_bytes<Math.max(old.default_bytes,old.used_bytes+old.reserved_bytes))throw new Failure(400,'QUOTA_TOO_SMALL','容量不能低于默认值或当前已用及预留空间');const key=uid(),at=now(),changed=old.limit_bytes!==a.limit_bytes;return {result:{archive_id:a.archive_id,version:old.version+(changed?1:0),limit_bytes:a.limit_bytes,changed},statements:[this.subjectGuard(a.archive_id,key+':archive'),this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archives WHERE id=? AND material_quota_version=?) AND (SELECT coalesce(sum(byte_size),0) FROM materials WHERE archive_id=? AND (${stored} OR ${reservation}))<=? THEN 1 ELSE 0 END)`,key+':quota',a.archive_id,a.expected_version,a.archive_id,at,at,at,a.limit_bytes),...(changed?[this.stmt('UPDATE archives SET material_quota_bytes=?,material_quota_version=material_quota_version+1,version=version+1,updated_at=? WHERE id=?',a.limit_bytes,at,a.archive_id),this.archives.event(a.archive_id,'material.capacity_changed',{limit_bytes:old.limit_bytes},{limit_bytes:a.limit_bytes},at)]:[]),this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key+':archive',key+':quota')]};});}
 async read(id:string,preview=false){const {material}=await this.get(id);if(material.state!=='ready')throw new Failure(404,'MATERIAL_NOT_FOUND','材料已经清除或正在清除');const row=await this.row(id),object=await this.env.IMAGES.get(row.object_key);if(!object)throw new Failure(404,'MATERIAL_OBJECT_MISSING','材料文件暂不可用');const inline=preview&&previewTypes.has(row.mime_type);const headers=new Headers({'Content-Type':inline?row.mime_type:'application/octet-stream','Content-Length':String(object.size),'Content-Disposition':`${inline?'inline':'attachment'}; filename="material"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'self'",'X-Frame-Options':'SAMEORIGIN'});return new Response(object.body,{headers});}
}

async function purgeObject(env:Env,row:Pick<MaterialRow,'id'|'state'|'object_key'>){if(row.state!=='purging')return;await env.IMAGES.delete(row.object_key);await env.DB.prepare("UPDATE materials SET state='purged',name='',description='',ticket_hash='',upload_claim=NULL,lease_until=NULL WHERE id=? AND state='purging'").bind(row.id).run();}
export async function cleanupMaterials(env:Env,at=Date.now()){
 const time=new Date(at).toISOString(),grace=new Date(at-60*60000).toISOString();
 const rows=await env.DB.prepare("SELECT id,state,object_key FROM materials WHERE state='purging' OR (state IN ('pending','uploading','expired','cancelled') AND ticket_expires_at<? AND (lease_until IS NULL OR lease_until<?)) ORDER BY created_at LIMIT 50").bind(grace,grace).all<Pick<MaterialRow,'id'|'state'|'object_key'>>();
 for(const row of rows.results){try{if(row.state==='purging'){await purgeObject(env,row);continue;}
  const claimed=await env.DB.prepare("UPDATE materials SET state='expired',upload_claim=NULL,lease_until=NULL WHERE id=? AND state IN ('pending','uploading','expired','cancelled') AND ticket_expires_at<? AND (lease_until IS NULL OR lease_until<?)").bind(row.id,grace,grace).run();if(!claimed.meta.changes)continue;
  await env.IMAGES.delete(row.object_key);await env.DB.prepare("UPDATE materials SET state='purged',name='',description='',ticket_hash='',updated_at=? WHERE id=? AND state='expired'").bind(time,row.id).run();
 }catch{console.warn(JSON.stringify({event:'materials.cleanup_retry',id:row.id}));}}
}
