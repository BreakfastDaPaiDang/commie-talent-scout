import {z} from 'zod';
import {command,requestId,expectedVersion,type Source} from './commands.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';

export const archiveType=z.enum(['person','org']);
const contact=z.object({type:z.string().trim().min(1).max(40),value:z.string().trim().min(1).max(500),note:z.string().trim().max(500).default('')}).strict().refine(c=>c.type.toUpperCase()!=='QQ'||/^\d{5,20}$/.test(c.value),{message:'QQ 使用 5–20 位数字字符串',path:['value']});
const link=z.object({label:z.string().trim().max(100).default(''),url:z.url().max(2000).refine(v=>['https:','http:'].includes(new URL(v).protocol),'链接仅支持 http 或 https')}).strict();
const profile={name:z.string().trim().min(1,'名称不能为空').max(120),contacts:z.array(contact).max(20).default([]),links:z.array(link).max(20).default([])};
export const archiveCreateInput=z.object({type:archiveType,...profile,request_id:requestId}).strict();
export const archiveUpdateInput=z.object({id:z.uuid(),expected_version:expectedVersion,...profile,contacts:z.array(contact).max(20),links:z.array(link).max(20),request_id:requestId}).strict();
export const archiveListInput=z.object({type:archiveType,query:z.string().trim().max(200).default(''),limit:z.coerce.number().int().min(1).max(100).default(30),before:z.string().max(150).optional()});
type Row={id:string;type:'person'|'org';name:string;contacts_json:string;links_json:string;status:string;closed:number;last_open_status:string|null;avatar_id:string|null;created_by:string;created_at:string;updated_at:string;version:number};
export type Archive=Omit<Row,'contacts_json'|'links_json'|'closed'>&{contacts:z.infer<typeof contact>[];links:z.infer<typeof link>[];closed:boolean;observation_count:number;members:{id:string;name:string;frozen:boolean}[]};
function present(row:Row):Archive{const {contacts_json,links_json,...rest}=row;return {...rest,closed:!!row.closed,contacts:JSON.parse(contacts_json),links:JSON.parse(links_json),observation_count:0,members:[]};}

// Archives owns the version/closed transaction boundary used by profile and future content changes.
export class Archives{
 constructor(readonly env:Env,readonly actor:Actor,readonly source:Source){}
 stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async get(id:string,version?:number,open=false){
  z.uuid().parse(id);const row=await this.stmt('SELECT * FROM archives WHERE id=?',id).first<Row>();
  if(!row)throw new Failure(404,'NOT_FOUND','档案不存在');
  if(open&&row.closed)throw new Failure(409,'ARCHIVE_CLOSED','档案已关闭，请先核对；修改不能替代显式重新开启');
  if(version!==undefined&&row.version!==version)throw new Failure(409,'VERSION_CONFLICT','档案已被更新，请重新读取后核对');
  return present(row);
 }
 guard(id:string,version:number,key:string,open=true){return this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archives WHERE id=? AND version=? ${open?'AND closed=0':''}) THEN 1 ELSE 0 END)`,key,id,version);}
 event(id:string,kind:string,before:unknown,after:unknown,at=now(),observationId:string|null=null){return this.stmt('INSERT INTO archive_events(id,archive_id,actor_id,source,kind,before_json,after_json,observation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),id,this.actor.id,this.source,kind,JSON.stringify(before),JSON.stringify(after),observationId,at);}
 async detail(id:string){return {archive:await this.get(id)};}
 async list(input:unknown){
  const a=archiveListInput.parse(input),where=['type=?'],args:unknown[]=[a.type];
  if(a.query){where.push("(name LIKE ? ESCAPE '\\' OR contacts_json LIKE ? ESCAPE '\\')");const value='%'+a.query.replace(/[\\%_]/g,'\\$&')+'%';args.push(value,value);}
  if(a.before){const [time,id]=a.before.split('|');if(!time||!id)throw new Failure(400,'INVALID_CURSOR','分页位置无效');where.push('(updated_at<? OR (updated_at=? AND id<?))');args.push(time,time,id);}
  const rows=await this.stmt(`SELECT * FROM archives WHERE ${where.join(' AND ')} ORDER BY updated_at DESC,id DESC LIMIT ?`,...args,a.limit+1).all<Row>();
  const items=rows.results.slice(0,a.limit).map(present),last=items.at(-1);
  return {archives:items,next_cursor:rows.results.length>a.limit&&last?`${last.updated_at}|${last.id}`:null};
 }
 async create(input:unknown){const a=archiveCreateInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'archive.create',parameters:{...a,request_id:undefined}},async()=>{
  const id=uid(),at=now();return {result:{id,version:1,changed:true},statements:[this.stmt('INSERT INTO archives(id,type,name,contacts_json,links_json,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,a.type,a.name,JSON.stringify(a.contacts),JSON.stringify(a.links),this.actor.id,at,at),this.event(id,'archive.created',null,{type:a.type,name:a.name,contacts:a.contacts,links:a.links,status:'视奸观察'},at)]};
 });}
 async update(input:unknown){const a=archiveUpdateInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'archive.update',parameters:{...a,request_id:undefined}},async()=>{
  const old=await this.get(a.id,a.expected_version,true),key=uid(),before={name:old.name,contacts:old.contacts,links:old.links},after={name:a.name,contacts:a.contacts,links:a.links},changed=JSON.stringify(before)!==JSON.stringify(after),at=now();
  const statements=[this.guard(a.id,a.expected_version,key)];
  if(changed)statements.push(this.stmt('UPDATE archives SET name=?,contacts_json=?,links_json=?,version=version+1,updated_at=? WHERE id=?',a.name,JSON.stringify(a.contacts),JSON.stringify(a.links),at,a.id),this.event(a.id,'archive.profile_changed',before,after,at));
  statements.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',key));return {result:{id:a.id,version:old.version+(changed?1:0),changed},statements};
 });}
 async events(input:unknown){
  const a=z.object({id:z.uuid(),before:z.coerce.number().int().positive().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)}).parse(input);await this.get(a.id);
  const rows=await this.stmt(`SELECT e.*,(SELECT name FROM members WHERE id=e.actor_id) actor_name FROM archive_events e WHERE archive_id=? ${a.before?'AND seq<?':''} ORDER BY seq DESC LIMIT ?`,a.id,...(a.before?[a.before]:[]),a.limit+1).all<Record<string,unknown>>();
  const events:Record<string,unknown>[]=rows.results.slice(0,a.limit).map(({before_json,after_json,...e})=>({...e,before:before_json?JSON.parse(String(before_json)):null,after:after_json?JSON.parse(String(after_json)):null}));
  return {events,next_cursor:rows.results.length>a.limit?String(events.at(-1)?.seq):null};
 }
}
