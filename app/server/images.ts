import {z} from 'zod';
import {Archives} from './archives.ts';
import {authGuard} from './credentials.ts';
import {Failure,digest,now,uid,type Actor,type Env} from './types.ts';
import {inspectImage,imageHash,MAX_IMAGE_BYTES} from './image-format.ts';
import type {Source} from './commands.ts';

export const imageIds=z.array(z.uuid()).max(10,'每条观察最多 10 张图片').refine(ids=>new Set(ids).size===ids.length,'图片不能重复');
export const prepareImageInput=z.object({purpose:z.enum(['observation','archive_avatar','member_avatar']),archive_id:z.uuid().optional(),member_id:z.uuid().optional(),mime_type:z.enum(['image/png','image/jpeg','image/webp']),byte_size:z.number().int().min(1).max(MAX_IMAGE_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/,'SHA-256 使用小写十六进制')}).strict().refine(a=>a.purpose==='member_avatar'?!!a.member_id&&!a.archive_id:!!a.archive_id&&!a.member_id,'票据须且只能指定对应档案或猎头账号');
export type AttachmentInfo={id:string;mime_type:string;byte_size:number;width:number;height:number;url:string};
export function attachmentProjection(observation:string,version:string){return `(SELECT json_group_array(json_object('id',im.id,'mime_type',im.mime_type,'byte_size',im.byte_size,'width',im.width,'height',im.height)) FROM (SELECT a.id,a.mime_type,a.byte_size,a.width,a.height FROM version_attachments va JOIN attachments a ON a.id=va.attachment_id WHERE va.observation_id=${observation} AND va.content_version=${version} ORDER BY va.position) im)`;}
type Upload={id:string;owner_id:string;auth_epoch:number;credential_id:string;purpose:'observation'|'archive_avatar'|'member_avatar';archive_id:string|null;member_subject_id:string|null;observation_id:string|null;mime_type:string;byte_size:number;sha256:string;ticket_expires_at:string;state:string;object_key:string;width:number|null;height:number|null;lease_until:string|null;upload_claim:string|null;created_at:string};
let uploadActive=false;
const privateHeaders=(mime:string)=>new Headers({'Content-Type':mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
const rejectGuard=(e:unknown)=>{if(String(e).includes('CHECK constraint'))throw new Failure(409,'UPLOAD_PRECONDITION_CHANGED','账号、凭证、档案或上传状态已变化，请查询上传状态后核对');throw e;};

// Upload tickets, immutable object ownership and all durable references live behind this boundary.
// R2 and D1 are not a shared transaction: only a verified ready object can be referenced in D1.
export class Images{
 readonly archives:Archives;
 constructor(readonly env:Env,readonly actor:Actor,readonly source:Source){this.archives=new Archives(env,actor,source);}
 stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 info(row:Pick<Upload,'id'|'mime_type'|'byte_size'|'width'|'height'>):AttachmentInfo{return {id:row.id,mime_type:row.mime_type,byte_size:row.byte_size,width:row.width??0,height:row.height??0,url:`${this.env.APP_ORIGIN}/images/${row.id}`};}
 private async subject(purpose:Upload['purpose'],archiveId:string|null,memberId:string|null){
  if(purpose==='member_avatar'){
   if(memberId!==this.actor.id&&this.actor.role!=='admin')throw new Failure(403,'OWN_PROFILE_REQUIRED','只能维护自己的头像');
   if(!await this.stmt('SELECT 1 FROM members WHERE id=?',memberId).first())throw new Failure(404,'NOT_FOUND','猎头账号不存在');
  }else await this.archives.get(archiveId!,undefined,true);
 }
 subjectGuard(purpose:Upload['purpose'],archiveId:string|null,memberId:string|null,key:string){
  return purpose==='member_avatar'?this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members WHERE id=?) AND (?=? OR EXISTS(SELECT 1 FROM members WHERE id=? AND role='admin')) THEN 1 ELSE 0 END)",key,memberId,memberId,this.actor.id,this.actor.id):this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archives WHERE id=? AND closed=0) THEN 1 ELSE 0 END)',key,archiveId);
 }
 async prepare(input:unknown){
  const a=prepareImageInput.parse(input),id=uid(),key=uid(),subjectKey=uid(),at=now(),expires=new Date(Date.now()+10*60000).toISOString();await this.subject(a.purpose,a.archive_id??null,a.member_id??null);
  const secret='ctsu_'+[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
  try{await this.env.DB.batch([authGuard(this.env,this.actor,key),this.subjectGuard(a.purpose,a.archive_id??null,a.member_id??null,subjectKey),
   this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN (SELECT count(*) FROM attachments WHERE owner_id=? AND ticket_expires_at>? AND state IN ('pending','uploading'))<50 THEN 1 ELSE 0 END)",key+':limit',this.actor.id,at),
   this.stmt('INSERT INTO attachments(id,owner_id,auth_epoch,credential_id,purpose,archive_id,member_subject_id,mime_type,byte_size,sha256,ticket_hash,ticket_expires_at,object_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,this.actor.id,this.actor.auth_epoch,this.actor.credential_id,a.purpose,a.archive_id??null,a.member_id??null,a.mime_type,a.byte_size,a.sha256,await digest(secret),expires,'uploads/'+id,at),
   this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?,?)',key,subjectKey,key+':limit'),
  ]);}catch(e){rejectGuard(e);}
  return {upload_id:id,attachment_id:id,method:'PUT',url:`${this.env.APP_ORIGIN}/uploads/${id}`,headers:{'Content-Type':a.mime_type,'X-Upload-Ticket':secret},expires_at:expires,byte_size:a.byte_size,sha256:a.sha256,limits:{max_bytes:MAX_IMAGE_BYTES,max_images_per_observation:10,max_pixels:40_000_000},recovery:'上传票据只用于这一次固定内容上传，不回显到聊天或记录。完成后查询上传状态取得可引用附件；准备响应丢失可重新准备，不会发布观察。'};
 }
 async status(id:string){z.uuid().parse(id);const row=await this.stmt('SELECT * FROM attachments WHERE id=? AND owner_id=?',id,this.actor.id).first<Upload>();if(!row)throw new Failure(404,'UPLOAD_NOT_FOUND','上传不存在或不属于本人');return {upload_id:id,state:row.state==='ready'?'ready':row.ticket_expires_at<=now()?'expired':row.state,attachment:row.state==='ready'?this.info(row):null,expires_at:row.ticket_expires_at,retry_after:row.state==='uploading'?row.lease_until:null};}
 static async receive(env:Env,id:string,request:Request){
  z.uuid().parse(id);const token=request.headers.get('X-Upload-Ticket');if(!token||token.length>100)throw new Failure(401,'UPLOAD_TICKET_INVALID','缺少有效上传票据');
  const row=await env.DB.prepare('SELECT * FROM attachments WHERE id=? AND ticket_hash=?').bind(id,await digest(token)).first<Upload>();if(!row)throw new Failure(401,'UPLOAD_TICKET_INVALID','上传票据不匹配');
  const actor=await env.DB.prepare("SELECT m.id,m.username,m.name,m.role,m.frozen,m.auth_epoch,m.must_change_password,m.version,m.qq,m.avatar_id,c.id credential_id,c.kind credential_kind FROM members m JOIN credentials c ON c.member_id=m.id WHERE m.id=? AND m.auth_epoch=? AND m.frozen=0 AND m.must_change_password=0 AND c.id=? AND c.auth_epoch=m.auth_epoch AND c.revoked_at IS NULL AND c.expires_at>?").bind(row.owner_id,row.auth_epoch,row.credential_id,now()).first<Actor>();
  if(!actor)throw new Failure(401,'UPLOAD_AUTH_EXPIRED','账号或原凭证已失效，这张上传票据不能继续使用');
  return new Images(env,actor,'web').upload(row,request);
 }
 private async upload(row:Upload,request:Request){
  if(row.ticket_expires_at<=now())throw new Failure(410,'UPLOAD_EXPIRED','上传票据已过期，请重新准备');
  if(row.state==='ready')throw new Failure(409,'UPLOAD_ALREADY_COMPLETE','图片已经上传完成，请查询状态，不要重复上传');
  if(!['pending','uploading'].includes(row.state))throw new Failure(409,'UPLOAD_UNAVAILABLE','上传状态已变化');
  if(row.state==='uploading'&&row.lease_until&&row.lease_until>now())throw new Failure(409,'UPLOAD_IN_PROGRESS','这张图片正在上传，请查询状态');
  if(request.headers.get('Content-Type')?.split(';')[0]!==row.mime_type||Number(request.headers.get('Content-Length'))!==row.byte_size)throw new Failure(400,'UPLOAD_METADATA_MISMATCH','上传字节数或类型与票据不一致');
  await this.subject(row.purpose,row.archive_id,row.member_subject_id);if(uploadActive)throw new Failure(429,'UPLOAD_BUSY','图片处理繁忙，请稍后原票据重试');uploadActive=true;
  const key=uid(),subjectKey=uid(),claim=uid(),lease=new Date(Date.now()+90*1000).toISOString();
  try{
   await this.env.DB.batch([authGuard(this.env,this.actor,key),this.subjectGuard(row.purpose,row.archive_id,row.member_subject_id,subjectKey),
    this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM attachments WHERE id=? AND ticket_expires_at>? AND (state='pending' OR (state='uploading' AND lease_until<=?))) THEN 1 ELSE 0 END)",key+':claim',row.id,now(),now()),
    this.stmt("UPDATE attachments SET state='uploading',upload_claim=?,lease_until=? WHERE id=?",claim,lease,row.id),this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?,?)',key,subjectKey,key+':claim'),
   ]).catch(rejectGuard);
   const bytes=await boundedImageBody(request.body,row.byte_size),format=inspectImage(bytes);
   if(format.mime_type!==row.mime_type||await imageHash(bytes)!==row.sha256)throw new Failure(400,'IMAGE_CONTENT_MISMATCH','图片实际格式或 SHA-256 与票据不一致');
   await this.env.IMAGES.put(row.object_key,bytes,{httpMetadata:{contentType:row.mime_type},sha256:row.sha256});
   const ready=now();await this.env.DB.batch([authGuard(this.env,this.actor,key),this.subjectGuard(row.purpose,row.archive_id,row.member_subject_id,subjectKey),
    this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM attachments WHERE id=? AND state='uploading' AND upload_claim=? AND ticket_expires_at>?) THEN 1 ELSE 0 END)",key+':finish',row.id,claim,ready),
    this.stmt("UPDATE attachments SET state='ready',width=?,height=?,ready_at=?,lease_until=NULL,upload_claim=NULL WHERE id=?",format.width,format.height,ready,row.id),this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?,?)',key,subjectKey,key+':finish'),
   ]).catch(rejectGuard);
   return {upload_id:row.id,state:'ready',attachment:this.info({...row,...format})};
  }finally{
   uploadActive=false;
   // A failed/abandoned attempt can retry the same immutable bytes while the ticket remains valid.
   await this.stmt("UPDATE attachments SET state='pending',upload_claim=NULL,lease_until=NULL WHERE id=? AND state='uploading' AND upload_claim=?",row.id,claim).run().catch(()=>{});
  }
 }
 async planVersion(ids:string[],archiveId:string,observationId:string,version:number){
  imageIds.parse(ids);const statements:D1PreparedStatement[]=[],cleanup:D1PreparedStatement[]=[];
  for(const [position,id] of ids.entries()){
   const row=await this.stmt('SELECT * FROM attachments WHERE id=?',id).first<Upload>();
   if(!row||row.state!=='ready'||row.purpose!=='observation'||row.archive_id!==archiveId||(row.observation_id!==observationId&&(row.observation_id!==null||row.owner_id!==this.actor.id)))throw new Failure(400,'ATTACHMENT_UNAVAILABLE','图片未完成上传、属于其他档案/记录，或不是本人暂存图片');
   const key=uid();statements.push(this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM attachments WHERE id=? AND state='ready' AND purpose='observation' AND archive_id=? AND (observation_id=? OR (observation_id IS NULL AND owner_id=?))) THEN 1 ELSE 0 END)",key,id,archiveId,observationId,this.actor.id),this.stmt('UPDATE attachments SET observation_id=? WHERE id=? AND observation_id IS NULL',observationId,id),this.stmt('INSERT INTO version_attachments(observation_id,content_version,attachment_id,position) VALUES(?,?,?,?)',observationId,version,id,position));cleanup.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
  }
  return {statements,cleanup};
 }
 async versionImages(observationId:string,version:number){const rows=await this.stmt('SELECT a.id,a.mime_type,a.byte_size,a.width,a.height FROM version_attachments v JOIN attachments a ON a.id=v.attachment_id WHERE v.observation_id=? AND v.content_version=? ORDER BY v.position',observationId,version).all<Upload>();return rows.results.map(r=>this.info(r));}
 async draftImages(archiveId:string){const rows=await this.stmt('SELECT a.id,a.mime_type,a.byte_size,a.width,a.height FROM draft_attachments d JOIN attachments a ON a.id=d.attachment_id WHERE d.member_id=? AND d.archive_id=? ORDER BY d.position',this.actor.id,archiveId).all<Upload>();return rows.results.map(r=>this.info(r));}
 async planDraft(ids:string[],archiveId:string){
  imageIds.parse(ids);const statements:D1PreparedStatement[]=[this.stmt('DELETE FROM draft_attachments WHERE member_id=? AND archive_id=?',this.actor.id,archiveId)],cleanup:D1PreparedStatement[]=[];
  for(const [position,id] of ids.entries()){
   if(!await this.stmt("SELECT 1 FROM attachments WHERE id=? AND state='ready' AND owner_id=? AND purpose='observation' AND archive_id=?",id,this.actor.id,archiveId).first())throw new Failure(400,'ATTACHMENT_UNAVAILABLE','草稿图片未完成上传，或不属于本人和此档案');
   const key=uid();statements.push(this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM attachments WHERE id=? AND state='ready' AND owner_id=? AND purpose='observation' AND archive_id=?) THEN 1 ELSE 0 END)",key,id,this.actor.id,archiveId),this.stmt('INSERT INTO draft_attachments(member_id,archive_id,attachment_id,position) VALUES(?,?,?,?)',this.actor.id,archiveId,id,position));cleanup.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
  }
  return {statements,cleanup};
 }
 async read(id:string){
  z.uuid().parse(id);const row=await this.stmt("SELECT * FROM attachments WHERE id=? AND state='ready'",id).first<Upload>();if(!row)throw new Failure(404,'IMAGE_NOT_FOUND','图片不存在或已清理');
  if(row.observation_id){if(!await this.stmt("SELECT 1 FROM observations WHERE id=? AND (deleted=0 OR author_id=? OR ?='admin')",row.observation_id,this.actor.id,this.actor.role).first())throw new Failure(404,'IMAGE_NOT_FOUND','图片不存在或无权读取');}
  else if(row.purpose==='observation'){if(row.owner_id!==this.actor.id)throw new Failure(404,'IMAGE_NOT_FOUND','图片不存在或无权读取');}
  else {const used=await this.stmt('SELECT 1 FROM avatar_history WHERE attachment_id=? OR previous_attachment_id=? LIMIT 1',id,id).first();if(!used&&row.owner_id!==this.actor.id)throw new Failure(404,'IMAGE_NOT_FOUND','图片不存在或无权读取');}
  return this.objectResponse(row.object_key,row.mime_type);
 }
 async objectResponse(key:string,mime:string){const object=await this.env.IMAGES.get(key);if(!object)throw new Failure(404,'IMAGE_NOT_FOUND','图片对象暂不可读');const headers=privateHeaders(mime);headers.set('Content-Length',String(object.size));return new Response(object.body,{headers});}
}

export async function boundedImageBody(stream:ReadableStream<Uint8Array>|null,expected:number,deadlineMs=60000){
 if(!stream||expected<1||expected>MAX_IMAGE_BYTES)throw new Failure(413,'IMAGE_SIZE','图片字节数超出允许范围');
 const reader=stream.getReader(),bytes=new Uint8Array(expected);let offset=0;const deadline=Date.now()+deadlineMs;
 try{while(true){let timer:ReturnType<typeof setTimeout>|undefined;const remaining=Math.min(15000,deadline-Date.now());if(remaining<=0)throw new Failure(408,'UPLOAD_TIMEOUT','图片上传超时，请查询状态后重试');const part=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Failure(408,'UPLOAD_TIMEOUT','图片上传超时，请查询状态后重试')),remaining);})]).finally(()=>clearTimeout(timer));if(part.done)break;if(offset+part.value.length>expected)throw new Failure(413,'IMAGE_SIZE','实际字节数超过上传票据');bytes.set(part.value,offset);offset+=part.value.length;}if(offset!==expected)throw new Failure(400,'UPLOAD_INCOMPLETE','图片未完整传输');return bytes;}finally{await reader.cancel().catch(()=>{});}
}

const unreferenced="NOT EXISTS(SELECT 1 FROM version_attachments v WHERE v.attachment_id=a.id) AND NOT EXISTS(SELECT 1 FROM draft_attachments d WHERE d.attachment_id=a.id) AND NOT EXISTS(SELECT 1 FROM avatar_history h WHERE h.attachment_id=a.id OR h.previous_attachment_id=a.id) AND NOT EXISTS(SELECT 1 FROM archives ar WHERE ar.avatar_id=a.id) AND NOT EXISTS(SELECT 1 FROM members m WHERE m.avatar_id=a.id)";
export async function cleanupImages(env:Env,at=Date.now()){
 const cutoff=new Date(at-86400000).toISOString(),time=new Date(at).toISOString();
 const rows=await env.DB.prepare(`SELECT a.id,a.object_key FROM attachments a WHERE a.created_at<? AND ${unreferenced} AND (a.state IN ('pending','ready','expired') OR a.lease_until<=?) LIMIT 50`).bind(cutoff,time).all<{id:string;object_key:string}>();
 for(const row of rows.results){
  const claimed=await env.DB.prepare(`UPDATE attachments AS a SET state='cleaning',lease_until=? WHERE a.id=? AND ${unreferenced} AND (a.state IN ('pending','ready','expired') OR a.lease_until<=?)`).bind(new Date(at+5*60000).toISOString(),row.id,time).run();if(!claimed.meta.changes)continue;
  try{await env.IMAGES.delete(row.object_key);await env.DB.prepare("DELETE FROM attachments WHERE id=? AND state='cleaning'").bind(row.id).run();}catch{console.warn(JSON.stringify({event:'images.cleanup_retry',id:row.id}));}
 }
}
