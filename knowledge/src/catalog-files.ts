import {z} from 'zod';
import {Catalog} from './catalog.ts';
import {KnowledgeError,hash,uid} from './types.ts';

export const filePrepare=z.object({request_id:z.uuid(),id:z.uuid(),name:z.string().trim().min(1).max(180),mime:z.enum(['application/pdf','text/plain','text/markdown','image/png','image/jpeg','image/webp','image/gif','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),bytes:z.number().int().positive().max(10485760),sha256:z.string().regex(/^[a-f0-9]{64}$/),entry_id:z.uuid().nullable().default(null)}).strict();
export class CatalogFiles{
 constructor(readonly service:Catalog){}
 get bucket(){const b=this.service.env.CATALOG_FILES;if(!b)throw new KnowledgeError(503,'FILE_STORE_UNAVAILABLE','附件服务暂不可用');return b;}
 async prepare(input:unknown){const a=filePrepare.parse(input),s=this.service;this.bucket;return s.mutate('file.prepare',a,async()=>{
  if(a.entry_id&&!await s.manages('entry',await s.rawEntry(a.entry_id)))throw new KnowledgeError(403,'MAINTAINER_REQUIRED','仅维护者可以上传此记录的附件');
  const count=await s.stmt('SELECT count(*) n FROM catalog_files WHERE author_id=? AND state=\'pending\'',s.actor.id).first<{n:number}>();if((count?.n??0)>=30)throw new KnowledgeError(409,'UPLOAD_LIMIT','未完成上传过多，请先完成已有上传');
  return {statements:[s.stmt('INSERT INTO catalog_files VALUES(?,?,?,?,?,?,?,?,?,?)',a.id,a.entry_id,s.actor.id,a.name.replace(/[\r\n\\/]/g,'_'),a.mime,a.bytes,a.sha256,'catalog/'+uid()+'/'+a.id,'pending',s.clock())],result:{id:a.id,state:'pending'}};
 });}
 async upload(id:string,request:Request){
  const s=this.service;s.member();const f=await s.stmt('SELECT * FROM catalog_files WHERE id=? AND author_id=?',z.uuid().parse(id),s.actor.id).first<Record<string,unknown>>();if(!f)throw new KnowledgeError(404,'NOT_FOUND','上传不存在');
  if(f.state==='ready')return {id,state:'ready'};const bytes=await request.arrayBuffer();if(bytes.byteLength!==f.bytes||bytes.byteLength>10485760)throw new KnowledgeError(400,'FILE_SIZE','文件大小与准备信息不一致');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');if(digest!==f.sha256)throw new KnowledgeError(400,'FILE_CONTENT','文件内容与准备信息不一致');
  await this.bucket.put(String(f.object_key),bytes,{httpMetadata:{contentType:String(f.mime)},customMetadata:{sha256:digest}});
  await s.stmt("UPDATE catalog_files SET state='ready' WHERE id=? AND author_id=? AND state='pending'",id,s.actor.id).run();return {id,state:'ready'};
 }
 async download(id:string){
  const s=this.service;await s.readable();const f=await s.stmt('SELECT * FROM catalog_files WHERE id=? AND state=\'ready\'',z.uuid().parse(id)).first<Record<string,unknown>>();if(!f)throw new KnowledgeError(404,'NOT_FOUND','附件不存在');
  let allowed=false;
  if(f.entry_id){const e=await s.rawEntry(String(f.entry_id)),data=JSON.parse(String(e.content_json));allowed=!e.deleted&&data.attachment_ids.includes(id);if(!allowed&&!s.guest)allowed=await s.manages('entry',e);}
  if(!allowed&&!s.guest&&f.author_id===s.actor.id)allowed=true;
  if(!allowed)throw new KnowledgeError(404,'NOT_FOUND','附件不存在');
  const object=await this.bucket.get(String(f.object_key));if(!object)throw new KnowledgeError(503,'FILE_UNAVAILABLE','附件暂时无法读取');
  return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(String(f.name)).replaceAll("'",'%27')}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
}
