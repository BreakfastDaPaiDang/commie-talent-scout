import {z} from 'zod';
import {command,requestId,expectedVersion,type Source} from './commands.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';
import {statesFor,isClosedState,isWorkState,personStates,orgStates} from '../shared/archive-states.ts';

export const archiveType=z.enum(['person','org']);
const contact=z.object({type:z.string().trim().min(1).max(40),value:z.string().trim().min(1).max(500),note:z.string().trim().max(500).default('')}).strict().refine(c=>c.type.toUpperCase()!=='QQ'||/^\d{5,20}$/.test(c.value),{message:'QQ 使用 5–20 位数字字符串',path:['value']});
const link=z.object({label:z.string().trim().max(100).default(''),url:z.url().max(2000).refine(v=>['https:','http:'].includes(new URL(v).protocol),'链接仅支持 http 或 https')}).strict();
const profile={name:z.string().trim().min(1,'名称不能为空').max(120),contacts:z.array(contact).max(20).default([]),links:z.array(link).max(20).default([])};
const statusInput=z.enum([...personStates,...orgStates]);
const memberIds=z.array(z.uuid()).max(50).transform(ids=>[...new Set(ids)].sort());
export const archiveCreateInput=z.object({type:archiveType,...profile,status:statusInput.default('视奸观察'),member_ids:memberIds.default([]),request_id:requestId}).strict();
export const archiveUpdateInput=z.object({id:z.uuid(),expected_version:expectedVersion,...profile,contacts:z.array(contact).max(20),links:z.array(link).max(20),request_id:requestId}).strict();
export const archiveStateInput=z.object({id:z.uuid(),expected_version:expectedVersion,status:statusInput,member_ids:memberIds,request_id:requestId}).strict();
export const archiveListInput=z.object({type:archiveType,query:z.string().trim().max(200).default(''),limit:z.coerce.number().int().min(1).max(100).default(30),before:z.string().max(150).optional()});
type Row={id:string;type:'person'|'org';name:string;contacts_json:string;links_json:string;status:string;closed:number;last_open_status:string|null;avatar_id:string|null;created_by:string;created_at:string;updated_at:string;version:number};
export type BoundMember={id:string;name:string;frozen:boolean};
export type Archive=Omit<Row,'contacts_json'|'links_json'|'closed'>&{contacts:z.infer<typeof contact>[];links:z.infer<typeof link>[];closed:boolean;observation_count:number;members:BoundMember[];bindings:Record<string,BoundMember[]>};
function present(row:Row&{members_json?:string}):Archive{const {contacts_json,links_json,members_json,...rest}=row;return {...rest,closed:!!row.closed,contacts:JSON.parse(contacts_json),links:JSON.parse(links_json),observation_count:0,members:JSON.parse(members_json??'[]').map((m:BoundMember)=>({...m,frozen:!!m.frozen})),bindings:{}};}
const currentMembers="(SELECT json_group_array(json_object('id',m.id,'name',m.name,'frozen',m.frozen)) FROM archive_bindings b JOIN members m ON m.id=b.member_id WHERE b.archive_id=a.id AND b.status=a.status) members_json";

// Archives owns the version/closed transaction boundary used by profile and future content changes.
export class Archives{
 constructor(readonly env:Env,readonly actor:Actor,readonly source:Source){}
 stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async get(id:string,version?:number,open=false){
  z.uuid().parse(id);const row=await this.stmt(`SELECT a.*,${currentMembers} FROM archives a WHERE a.id=?`,id).first<Row>();
  if(!row)throw new Failure(404,'NOT_FOUND','档案不存在');
  if(open&&row.closed)throw new Failure(409,'ARCHIVE_CLOSED','档案已关闭，请先核对；修改不能替代显式重新开启');
  if(version!==undefined&&row.version!==version)throw new Failure(409,'VERSION_CONFLICT','档案已被更新，请重新读取后核对');
  const archive=present(row),bindings=await this.stmt('SELECT b.status,m.id,m.name,m.frozen FROM archive_bindings b JOIN members m ON m.id=b.member_id WHERE b.archive_id=? ORDER BY m.name,m.id',id).all<BoundMember&{status:string}>();
  for(const {status,...m} of bindings.results)(archive.bindings[status]??=[]).push({...m,frozen:!!m.frozen});
  return archive;
 }
 guard(id:string,version:number,key:string,open=true){return this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archives WHERE id=? AND version=? ${open?'AND closed=0':''}) THEN 1 ELSE 0 END)`,key,id,version);}
 event(id:string,kind:string,before:unknown,after:unknown,at=now(),observationId:string|null=null){return this.stmt('INSERT INTO archive_events(id,archive_id,actor_id,source,kind,before_json,after_json,observation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),id,this.actor.id,this.source,kind,JSON.stringify(before),JSON.stringify(after),observationId,at);}
 async detail(id:string){return {archive:await this.get(id)};}
 async list(input:unknown){
  const a=archiveListInput.parse(input),where=['type=?'],args:unknown[]=[a.type];
  if(a.query){where.push("(name LIKE ? ESCAPE '\\' OR contacts_json LIKE ? ESCAPE '\\')");const value='%'+a.query.replace(/[\\%_]/g,'\\$&')+'%';args.push(value,value);}
  if(a.before){const [time,id]=a.before.split('|');if(!time||!id)throw new Failure(400,'INVALID_CURSOR','分页位置无效');where.push('(updated_at<? OR (updated_at=? AND id<?))');args.push(time,time,id);}
  const rows=await this.stmt(`SELECT a.*,${currentMembers} FROM archives a WHERE ${where.join(' AND ')} ORDER BY updated_at DESC,id DESC LIMIT ?`,...args,a.limit+1).all<Row>();
  const items=rows.results.slice(0,a.limit).map(present),last=items.at(-1);
  return {archives:items,next_cursor:rows.results.length>a.limit&&last?`${last.updated_at}|${last.id}`:null};
 }
 async create(input:unknown){const a=archiveCreateInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'archive.create',parameters:{...a,request_id:undefined}},async()=>{
  const id=uid(),at=now(),plan=await this.planBindings(id,a.type,a.status,a.member_ids),closed=isClosedState(a.status);
  return {result:{id,version:1,changed:true},statements:[...plan.guards,this.stmt('INSERT INTO archives(id,type,name,contacts_json,links_json,status,closed,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,a.type,a.name,JSON.stringify(a.contacts),JSON.stringify(a.links),a.status,closed?1:0,this.actor.id,at,at),...plan.bindings,this.event(id,'archive.created',null,{type:a.type,name:a.name,contacts:a.contacts,links:a.links,status:a.status,members:plan.members},at),...(closed?[this.event(id,'archive.closed',null,{status:a.status},at)]:[]),...plan.cleanup]};
 });}
 private async planBindings(id:string,type:'person'|'org',status:string,ids:string[]){
  if(!(statesFor(type) as readonly string[]).includes(status))throw new Failure(400,'INVALID_STATE','该状态不属于这类档案');
  if(isWorkState(type,status)&&ids.length===0)throw new Failure(400,'RESPONSIBLE_REQUIRED','工作状态必须明确选择至少一名负责成员');
  const members:BoundMember[]=[],guards:D1PreparedStatement[]=[],bindings:D1PreparedStatement[]=[],cleanup:D1PreparedStatement[]=[];
  for(const memberId of ids){
   const member=await this.stmt('SELECT id,name,frozen FROM members WHERE id=?',memberId).first<BoundMember>();
   if(!member)throw new Failure(400,'MEMBER_NOT_FOUND','选择的成员不存在');
   const retained=await this.stmt('SELECT 1 FROM archive_bindings WHERE archive_id=? AND member_id=? AND (status=? OR (?=1 AND status=(SELECT status FROM archives WHERE id=?)))',id,memberId,status,isClosedState(status)?1:0,id).first();
   if(member.frozen&&!retained)throw new Failure(409,'MEMBER_FROZEN','不能新分配已冻结成员；已有归属仍保留显示');
   members.push({...member,frozen:!!member.frozen});const key=uid();
   guards.push(this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members m WHERE id=? AND (frozen=0 OR EXISTS(SELECT 1 FROM archive_bindings WHERE archive_id=? AND member_id=m.id AND (status=? OR (?=1 AND status=(SELECT status FROM archives WHERE id=?)))))) THEN 1 ELSE 0 END)',key,memberId,id,status,isClosedState(status)?1:0,id));
   bindings.push(this.stmt('INSERT INTO archive_bindings(archive_id,status,member_id) VALUES(?,?,?)',id,status,memberId));cleanup.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
  }
  return {members,guards,bindings,cleanup};
 }
 async setState(input:unknown){return this.transition(input,false);}
 async reopen(input:unknown){return this.transition(input,true);}
 private async transition(input:unknown,reopen:boolean){
  const a=archiveStateInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:reopen?'archive.reopen':'archive.state',parameters:{...a,request_id:undefined}},async()=>{
   const old=await this.get(a.id,a.expected_version,!reopen),key=uid(),closed=isClosedState(a.status);
   if(reopen&&(!old.closed||closed))throw new Failure(409,'INVALID_REOPEN','只能显式重新开启已关闭档案，并选择开启类状态');
   const plan=await this.planBindings(a.id,old.type,a.status,a.member_ids),changed=reopen||a.status!==old.status||JSON.stringify(old.members.map(m=>m.id).sort())!==JSON.stringify(a.member_ids),at=now();
   const statements=[this.guard(a.id,a.expected_version,key,!reopen),...plan.guards];
   if(changed){
    statements.push(this.stmt('UPDATE archives SET status=?,closed=?,last_open_status=?,version=version+1,updated_at=? WHERE id=?',a.status,closed?1:0,closed?old.status:old.last_open_status,at,a.id),this.stmt('DELETE FROM archive_bindings WHERE archive_id=? AND status=?',a.id,a.status),...plan.bindings);
    const before={status:old.status,members:old.members},after={status:a.status,members:plan.members};
    statements.push(this.event(a.id,old.status!==a.status?'archive.state_changed':'archive.members_changed',before,after,at));
    if(closed)statements.push(this.event(a.id,'archive.closed',{status:old.status},{status:a.status},at));
    if(reopen)statements.push(this.event(a.id,'archive.reopened',{status:old.status},{status:a.status},at));
   }
   statements.push(...plan.cleanup,this.stmt('DELETE FROM mutation_guards WHERE id=?',key));return {result:{id:a.id,version:old.version+(changed?1:0),status:a.status,closed,changed},statements};
  });
 }
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
