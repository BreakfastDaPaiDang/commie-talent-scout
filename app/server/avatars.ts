import {z} from 'zod';
import {command,requestId,expectedVersion,type Source} from './commands.ts';
import {Images,boundedImageBody} from './images.ts';
import {inspectImage,MAX_IMAGE_BYTES} from './image-format.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';

export const avatarInput=z.object({subject_type:z.enum(['archive','member']),id:z.uuid(),expected_version:expectedVersion,attachment_id:z.uuid().nullable(),request_id:requestId}).strict();
type Subject={id:string;version:number;avatar_id:string|null;type?:'person'|'org';contacts_json?:string;qq?:string|null};
type Cache={object_key:string|null;mime_type:string|null;refresh_after:string;refreshing_until:string|null};
export class Avatars{
 private images:Images;
 constructor(private env:Env,private actor:Actor,private source:Source){this.images=new Images(env,actor,source);}
 private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 private async subject(type:'archive'|'member',id:string){
  z.uuid().parse(id);const row=await this.stmt(type==='archive'?'SELECT id,version,avatar_id,type,contacts_json FROM archives WHERE id=?':'SELECT id,version,avatar_id,qq FROM members WHERE id=?',id).first<Subject>();
  if(!row)throw new Failure(404,'NOT_FOUND','头像所属对象不存在');return row;
 }
 async set(value:unknown){
  const a=avatarInput.parse(value),isArchive=a.subject_type==='archive',purpose=isArchive?'archive_avatar':'member_avatar';
  if(!isArchive&&a.id!==this.actor.id&&this.actor.role!=='admin')throw new Failure(403,'OWN_PROFILE_REQUIRED','只能维护本人的头像');
  const requireAdmin=!isArchive&&a.id!==this.actor.id;
  return command(this.env,this.actor,{requestId:a.request_id,operation:'avatar.set',parameters:{...a,request_id:undefined},requireAdmin},async()=>{
   const old=await this.subject(a.subject_type,a.id);if(old.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','资料已变化，请刷新后核对');
   if(isArchive)await this.images.archives.get(a.id,a.expected_version,true);
   const key=uid(),at=now(),changed=old.avatar_id!==a.attachment_id,table=isArchive?'archives':'members';
   const statements=[this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=? AND version=?${isArchive?' AND closed=0':''}) THEN 1 ELSE 0 END)`,key,a.id,a.expected_version)];
   if(changed&&a.attachment_id){
    const sql=`SELECT 1 FROM attachments WHERE id=? AND state='ready' AND owner_id=? AND purpose=? AND ${isArchive?'archive_id':'member_subject_id'}=?`;
    if(!await this.stmt(sql,a.attachment_id,this.actor.id,purpose,a.id).first())throw new Failure(400,'ATTACHMENT_UNAVAILABLE','头像图片未上传完成，或不属于本人及此对象');
    statements.push(this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(${sql}) THEN 1 ELSE 0 END)`,key+':image',a.attachment_id,this.actor.id,purpose,a.id));
   }
   if(changed){
    statements.push(this.stmt(`UPDATE ${table} SET avatar_id=?,version=version+1${isArchive?',updated_at=?':''} WHERE id=?`,a.attachment_id,...(isArchive?[at]:[]),a.id),this.stmt('INSERT INTO avatar_history(subject_type,subject_id,attachment_id,previous_attachment_id,actor_id,created_at) VALUES(?,?,?,?,?,?)',a.subject_type,a.id,a.attachment_id,old.avatar_id,this.actor.id,at));
    statements.push(isArchive?this.images.archives.event(a.id,'archive.avatar_changed',{avatar_id:old.avatar_id},{avatar_id:a.attachment_id},at):this.stmt('INSERT INTO member_events(id,actor_id,member_id,source,kind,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),this.actor.id,a.id,this.source,'member.avatar_changed',JSON.stringify({avatar_id:old.avatar_id}),JSON.stringify({avatar_id:a.attachment_id}),at));
   }
   statements.push(this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key,key+':image'));
   return {statements,result:{id:a.id,subject_type:a.subject_type,avatar_id:a.attachment_id,version:old.version+(changed?1:0),changed}};
  });
 }
 async read(type:'archive'|'member',id:string){
  const row=await this.subject(type,id);
  if(row.avatar_id){try{return await this.images.read(row.avatar_id);}catch(e){if(!(e instanceof Failure&&e.status===404))throw e;}}
  const qq=type==='member'?row.qq:row.type==='person'?(JSON.parse(row.contacts_json??'[]') as {type:string;value:string}[]).find(c=>c.type.toUpperCase()==='QQ'&&/^\d{5,20}$/.test(c.value))?.value:null;
  if(qq&&/^\d{5,20}$/.test(qq)){const response=await this.qq(qq);if(response)return response;}
  throw new Failure(404,'AVATAR_UNAVAILABLE','暂无可用头像');
 }
 private async qq(qq:string){
  let cache=await this.stmt('SELECT * FROM qq_avatar_cache WHERE qq=?',qq).first<Cache>();const at=now();
  if(!cache||cache.refresh_after<=at){
   await this.stmt('INSERT OR IGNORE INTO qq_avatar_cache(qq,refresh_after) VALUES(?,?)',qq,at).run();
   const lease=new Date(Date.now()+10000).toISOString();
   const claim=await this.stmt('UPDATE qq_avatar_cache SET refreshing_until=? WHERE qq=? AND refresh_after<=? AND (refreshing_until IS NULL OR refreshing_until<=?)',lease,qq,at,at).run();
   if(claim.meta.changes){
    try{
     const response=await fetch(`https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=640`,{signal:AbortSignal.timeout(3000),redirect:'error'});
     if(!response.ok)throw new Error('QQ upstream unavailable');
     const length=Number(response.headers.get('Content-Length'));
     // Bound both known-length and chunked upstream bodies before inspecting their actual format.
     let bytes:Uint8Array<ArrayBuffer>;
     if(length>0)bytes=await boundedImageBody(response.body,length,3000);
     else{
      const reader=response.body?.getReader();if(!reader)throw new Error('Empty avatar');const buffer=new Uint8Array(MAX_IMAGE_BYTES);let size=0;
      try{while(true){const part=await reader.read();if(part.done)break;if(size+part.value.length>MAX_IMAGE_BYTES)throw new Error('Oversize avatar');buffer.set(part.value,size);size+=part.value.length;}}finally{await reader.cancel().catch(()=>{});}
      bytes=buffer.subarray(0,size);
     }
     const format=inspectImage(bytes),key='qq/'+qq+'/'+uid();await this.env.IMAGES.put(key,bytes,{httpMetadata:{contentType:format.mime_type}});
     const saved=await this.stmt('UPDATE qq_avatar_cache SET object_key=?,mime_type=?,refreshed_at=?,refresh_after=?,refreshing_until=NULL,version=version+1 WHERE qq=? AND refreshing_until=?',key,format.mime_type,now(),new Date(Date.now()+86400000).toISOString(),qq,lease).run();
     if(saved.meta.changes){if(cache?.object_key?.startsWith('qq/'))await this.env.IMAGES.delete(cache.object_key);cache={object_key:key,mime_type:format.mime_type,refresh_after:'',refreshing_until:null};}else await this.env.IMAGES.delete(key);
    }catch{await this.stmt('UPDATE qq_avatar_cache SET refresh_after=?,refreshing_until=NULL WHERE qq=? AND refreshing_until=?',new Date(Date.now()+15*60000).toISOString(),qq,lease).run();}
   }
  }
  if(cache?.object_key&&cache.mime_type){try{return await this.images.objectResponse(cache.object_key,cache.mime_type);}catch(e){if(!(e instanceof Failure&&e.status===404))throw e;}}
  return null;
 }
}
