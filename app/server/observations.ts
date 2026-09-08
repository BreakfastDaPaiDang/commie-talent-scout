import {z} from 'zod';
import {Archives} from './archives.ts';
import {command,requestId,expectedVersion,type Source} from './commands.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';
import {TagState} from './tag-state.ts';
import {Images,imageIds,attachmentProjection,type AttachmentInfo} from './images.ts';

export const observationBody=z.string().max(100000,'正文最多 100,000 个字符');
export const occurredAt=z.iso.datetime({offset:true}).nullable();
export const observationCreateInput=z.object({archive_id:z.uuid(),body:observationBody.default(''),attachment_ids:imageIds.default([]),occurred_at:occurredAt.default(null),request_id:requestId}).strict().refine(a=>!!a.body.trim()||a.attachment_ids.length>0,'正文与图片至少有一项');
export const observationUpdateInput=z.object({id:z.uuid(),expected_version:expectedVersion,body:observationBody,attachment_ids:imageIds.optional().describe('完整图片列表；省略保留当前图片，空数组明确移除当前图片，旧版本仍保留。'),occurred_at:occurredAt,request_id:requestId}).strict();
export type Observation={id:string;archive_id:string;author_id:string;author_name:string;created_at:string;updated_at:string;version:number;content_version:number;body:string;occurred_at:string|null;deleted:boolean;editable:boolean;attachments:AttachmentInfo[];author_avatar_url:string};
type Row=Omit<Observation,'deleted'|'editable'|'attachments'|'author_avatar_url'>&{deleted:number;archive_closed:number;attachments_json:string;author_version:number};
const columns='o.id,o.archive_id,o.author_id,m.name author_name,o.created_at,o.updated_at,o.version,o.content_version,o.deleted,v.body,v.occurred_at,a.closed archive_closed,m.version author_version,'+attachmentProjection('o.id','o.content_version')+' attachments_json';
const joins='observations o JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version JOIN members m ON m.id=o.author_id JOIN archives a ON a.id=o.archive_id';

// Record identity, content history and visibility remain behind one service boundary.
// Events only reference a version; they never duplicate body text that deletion could expose later.
export class Observations{
 readonly archives:Archives;readonly images:Images;
 constructor(readonly env:Env,readonly actor:Actor,readonly source:Source){this.archives=new Archives(env,actor,source);this.images=new Images(env,actor,source);}
 private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 private present(row:Row):Observation{const {archive_closed,attachments_json,author_version,...o}=row;return {...o,attachments:JSON.parse(attachments_json??'[]').map((im:AttachmentInfo)=>this.images.info(im)),author_avatar_url:`${this.env.APP_ORIGIN}/avatars/members/${o.author_id}?v=${author_version}`,deleted:!!row.deleted,editable:!archive_closed&&!row.deleted&&(row.author_id===this.actor.id||this.actor.role==='admin')};}
 async get(id:string){z.uuid().parse(id);const row=await this.stmt(`SELECT ${columns} FROM ${joins} WHERE o.id=? AND (o.deleted=0 OR o.author_id=? OR ?='admin')`,id,this.actor.id,this.actor.role).first<Row>();if(!row)throw new Failure(404,'NOT_FOUND','观察记录不存在或无权读取');return this.present(row);}
 async rememberReads(items:{id:string;content_version:number}[]){if(this.source==='mcp'&&items.length)await this.env.DB.batch(items.map(o=>this.stmt('INSERT INTO observation_reads(credential_id,observation_id,content_version,read_at) VALUES(?,?,?,?) ON CONFLICT(credential_id,observation_id,content_version) DO UPDATE SET read_at=excluded.read_at',this.actor.credential_id,o.id,o.content_version,now())));}
 async detail(id:string){const observation=await this.get(id);await this.rememberReads([observation]);return {observation};}
 private authorizeEdit(o:Observation){if(o.author_id!==this.actor.id&&this.actor.role!=='admin')throw new Failure(403,'AUTHOR_REQUIRED','仅原作者或管理员可以修改这条观察');if(o.deleted)throw new Failure(409,'OBSERVATION_DELETED','记录已删除，请先核对');}
 private openGuard(id:string,key:string){return this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archives WHERE id=? AND closed=0) THEN 1 ELSE 0 END)',key,id);}
 private recordGuard(id:string,version:number,key:string){return this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM observations WHERE id=? AND version=? AND deleted=0) THEN 1 ELSE 0 END)',key,id,version);}
 private touch(id:string,at:string){return this.stmt('UPDATE archives SET version=version+1,updated_at=? WHERE id=?',at,id);}
 async create(input:unknown){const a=observationCreateInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'observation.create',parameters:{...a,attachment_ids:a.attachment_ids.length?a.attachment_ids:undefined,request_id:undefined}},async()=>{
  const archive=await this.archives.get(a.archive_id,undefined,true);const id=uid(),at=now(),key=uid(),images=await this.images.planVersion(a.attachment_ids,a.archive_id,id,1);
  return {result:{id,archive_id:a.archive_id,archive_url:this.archives.url(archive),version:1,content_version:1,changed:true},statements:[
   this.openGuard(a.archive_id,key),this.stmt('INSERT INTO observations(id,archive_id,author_id,created_at,updated_at) VALUES(?,?,?,?,?)',id,a.archive_id,this.actor.id,at,at),
   this.stmt('INSERT INTO observation_versions(observation_id,version,body,occurred_at,editor_id,created_at) VALUES(?,1,?,?,?,?)',id,a.body,a.occurred_at,this.actor.id,at),...images.statements,this.touch(a.archive_id,at),
   this.archives.event(a.archive_id,'observation.created',null,{id,content_version:1},at,id),...images.cleanup,this.stmt('DELETE FROM mutation_guards WHERE id=?',key),
  ]};
 });}
 async update(input:unknown){
  const a=observationUpdateInput.parse(input),identity=await this.get(a.id);this.authorizeEdit(identity);
  return command(this.env,this.actor,{requestId:a.request_id,operation:'observation.update',parameters:{...a,request_id:undefined},requireAdmin:identity.author_id!==this.actor.id},async()=>{
   const old=await this.get(a.id);this.authorizeEdit(old);const archive=await this.archives.get(old.archive_id,undefined,true);
   if(old.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','观察已被更新，请重新读取后核对');
   const ids=a.attachment_ids??old.attachments.map(im=>im.id);if(!a.body.trim()&&!ids.length)throw new Failure(400,'EMPTY_OBSERVATION','正文与图片至少有一项');
   const key=uid(),recordKey=uid(),changed=a.body!==old.body||a.occurred_at!==old.occurred_at||JSON.stringify(ids)!==JSON.stringify(old.attachments.map(im=>im.id)),at=now();
   const images=changed?await this.images.planVersion(ids,old.archive_id,a.id,old.content_version+1):{statements:[],cleanup:[]};
   const statements=[this.openGuard(old.archive_id,key),this.recordGuard(a.id,a.expected_version,recordKey)];
   if(changed)statements.push(this.stmt('INSERT INTO observation_versions(observation_id,version,body,occurred_at,editor_id,created_at) VALUES(?,?,?,?,?,?)',a.id,old.content_version+1,a.body,a.occurred_at,this.actor.id,at),...images.statements,this.stmt('UPDATE observations SET version=version+1,content_version=content_version+1,updated_at=? WHERE id=?',at,a.id),this.touch(old.archive_id,at),this.archives.event(old.archive_id,'observation.edited',{id:a.id,content_version:old.content_version},{id:a.id,content_version:old.content_version+1},at,a.id));
   statements.push(...images.cleanup,this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key,recordKey));
   return {result:{id:a.id,archive_id:old.archive_id,archive_url:this.archives.url(archive),version:old.version+(changed?1:0),content_version:old.content_version+(changed?1:0),changed},statements};
  });
 }
 async list(input:unknown){
  const a=z.object({archive_id:z.uuid(),before:z.string().max(150).optional(),limit:z.coerce.number().int().min(1).max(50).default(20)}).parse(input);await this.archives.get(a.archive_id);
  const where=['o.archive_id=?','o.deleted=0'],args:unknown[]=[a.archive_id];
  if(a.before){const [at,id]=a.before.split('|');if(!at||!id)throw new Failure(400,'INVALID_CURSOR','分页位置无效');where.push('(o.updated_at<? OR (o.updated_at=? AND o.id<?))');args.push(at,at,id);}
  const rows=await this.stmt(`SELECT ${columns} FROM ${joins} WHERE ${where.join(' AND ')} ORDER BY o.updated_at DESC,o.id DESC LIMIT ?`,...args,a.limit+1).all<Row>();
  const items=rows.results.slice(0,a.limit).map(r=>this.present(r)),last=items.at(-1);await this.rememberReads(items);return {observations:items,next_cursor:rows.results.length>a.limit&&last?`${last.updated_at}|${last.id}`:null};
 }
 async versions(input:unknown){
  const a=z.object({id:z.uuid(),before:z.coerce.number().int().positive().optional(),limit:z.coerce.number().int().min(1).max(50).default(10)}).parse(input);const record=await this.get(a.id);
  const r=await this.stmt(`SELECT v.version,v.body,v.occurred_at,v.editor_id,m.name editor_name,v.created_at,${attachmentProjection('v.observation_id','v.version')} attachments_json FROM observation_versions v JOIN members m ON m.id=v.editor_id WHERE v.observation_id=? ${a.before?'AND v.version<?':''} ORDER BY v.version DESC LIMIT ?`,a.id,...(a.before?[a.before]:[]),a.limit+1).all<Record<string,unknown>>();
  await this.rememberReads(r.results.slice(0,a.limit).map(v=>({id:a.id,content_version:Number(v.version)})));return {id:a.id,author_id:record.author_id,versions:r.results.slice(0,a.limit).map(({attachments_json,...v})=>({...v,attachments:JSON.parse(String(attachments_json??'[]')).map((im:AttachmentInfo)=>this.images.info(im))})),next_cursor:r.results.length>a.limit?String(r.results[a.limit-1].version):null};
 }
 async timeline(input:unknown){
  const a=z.object({id:z.uuid(),before:z.coerce.number().int().positive().optional(),limit:z.coerce.number().int().min(1).max(50).default(20)}).parse(input);await this.archives.get(a.id);
  const latest="e.seq=(SELECT max(t.seq) FROM archive_events t WHERE t.observation_id=e.observation_id)";
  const r=await this.stmt(`SELECT e.*,actor.name actor_name,o.id record_id,o.author_id,o.created_at record_created_at,o.updated_at record_updated_at,o.version record_version,o.content_version,o.deleted,m.name author_name,m.version author_version,v.occurred_at,a.closed archive_closed,${attachmentProjection('o.id','o.content_version')} attachments_json,CASE WHEN o.deleted=0 AND ${latest} THEN v.body ELSE NULL END observation_body FROM archive_events e JOIN members actor ON actor.id=e.actor_id JOIN archives a ON a.id=e.archive_id LEFT JOIN observations o ON o.id=e.observation_id LEFT JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version LEFT JOIN members m ON m.id=o.author_id WHERE e.archive_id=? ${a.before?'AND e.seq<?':''} ORDER BY e.seq DESC LIMIT ?`,a.id,...(a.before?[a.before]:[]),a.limit+1).all<Record<string,unknown>>();
  const events=r.results.slice(0,a.limit).map(e=>({id:e.id,seq:e.seq,archive_id:e.archive_id,actor_id:e.actor_id,actor_name:e.actor_name,source:e.source,kind:e.kind,created_at:e.created_at,observation_id:e.observation_id,before:e.before_json?JSON.parse(String(e.before_json)):null,after:e.after_json?JSON.parse(String(e.after_json)):null,
   observation:e.observation_body!==null?this.present({id:String(e.record_id),archive_id:a.id,author_id:String(e.author_id),author_name:String(e.author_name),created_at:String(e.record_created_at),updated_at:String(e.record_updated_at),version:Number(e.record_version),content_version:Number(e.content_version),deleted:0,body:String(e.observation_body),occurred_at:e.occurred_at as string|null,archive_closed:Number(e.archive_closed),author_version:Number(e.author_version),attachments_json:String(e.attachments_json??'[]')}):null,
  }));
  const state=new TagState(this.env,this.actor),visible=[];for(const e of events){if(e.kind==='archive.tags_changed'){e.before=await state.filterEvent(e.before);e.after=await state.filterEvent(e.after);if(!e.before.length&&!e.after.length)continue;}visible.push(e);}await this.rememberReads(visible.flatMap(e=>e.observation?[e.observation]:[]));return {events:visible,next_cursor:r.results.length>a.limit?String(events.at(-1)?.seq):null};
 }
}
