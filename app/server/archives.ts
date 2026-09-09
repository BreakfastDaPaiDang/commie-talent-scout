import {archiveOrderCte,archiveCursor,nextArchiveCursor} from './archive-order.ts';
import {archiveReminder,type ArchiveReminder} from '../shared/archive-reminders.ts';
import {z} from 'zod';
import {assertAdmin} from './credentials.ts';
import {command,requestId,expectedVersion,type Source} from './commands.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';
import {statesFor,isClosedState,isWorkState,personStates,orgStates} from '../shared/archive-states.ts';
import {TagState,evidenceVisibilitySql,type TagBinding,type TagLabel} from './tag-state.ts';
import {Reading,eventVisibility,unreadPredicate} from './reading.ts';

export const archiveType=z.enum(['person','org']);
const contact=z.object({type:z.string().trim().min(1).max(40),value:z.string().trim().min(1).max(500),note:z.string().trim().max(500).default('')}).strict().refine(c=>c.type.toUpperCase()!=='QQ'||/^\d{5,20}$/.test(c.value),{message:'QQ 使用 5–20 位数字字符串',path:['value']});
const link=z.object({label:z.string().trim().max(100).default(''),url:z.url().max(2000).refine(v=>['https:','http:'].includes(new URL(v).protocol),'链接仅支持 http 或 https')}).strict();
const profile={name:z.string().trim().min(1,'名称不能为空').max(120),contacts:z.array(contact).max(20).default([]),links:z.array(link).max(20).default([])};
const statusInput=z.enum([...personStates,...orgStates]);
const memberIds=z.array(z.uuid()).max(50).transform(ids=>[...new Set(ids)].sort());
export const archiveCreateInput=z.object({type:archiveType,...profile,status:statusInput.default('视奸观察'),member_ids:memberIds.default([]),request_id:requestId}).strict();
export const archiveUpdateInput=z.object({id:z.uuid(),expected_version:expectedVersion,...profile,contacts:z.array(contact).max(20),links:z.array(link).max(20),request_id:requestId}).strict();
export const archiveStateInput=z.object({id:z.uuid(),expected_version:expectedVersion,status:statusInput,member_ids:memberIds,request_id:requestId}).strict();
export const archiveDeletionInput=z.object({id:z.uuid(),expected_version:expectedVersion,request_id:requestId}).strict();
export const archiveListInput=z.object({type:archiveType,deleted:z.union([z.boolean(),z.enum(['true','false']).transform(v=>v==='true')]).default(false),query:z.string().trim().max(200).default(''),scope:z.enum(['all','mine','unread']).default('all').describe('mine 为关联我：当前状态关联成员包含调用者，不限工作或开启状态，仍遵循其他筛选和删除权限。'),status:z.string().max(80).default(''),member_id:z.union([z.uuid(),z.literal('')]).default(''),closed:z.enum(['all','open','closed']).default('all'),tag_ids:z.array(z.uuid()).max(30).default([]).describe('按当前词库类别分组：同类别任一标签匹配、不同类别同时匹配。关闭档案按冻结绑定匹配稳定标签 ID；仅计入当前成员可见的来源。'),limit:z.coerce.number().int().min(1).max(100).default(30),before:z.string().max(150).optional()});
type Row={id:string;type:'person'|'org';name:string;contacts_json:string;links_json:string;status:string;closed:number;deleted:number;deleted_at:string|null;deleted_by:string|null;deleted_snapshot_version:number|null;last_open_status:string|null;avatar_id:string|null;created_by:string;created_at:string;updated_at:string;version:number;tag_snapshot_version:number|null};
export type BoundMember={id:string;name:string;frozen:boolean};
export type Archive=Omit<Row,'contacts_json'|'links_json'|'closed'|'deleted'>&{contacts:z.infer<typeof contact>[];links:z.infer<typeof link>[];closed:boolean;deleted:boolean;update_reminder:ArchiveReminder;observation_count:number;latest_observation:string|null;members:BoundMember[];bindings:Record<string,BoundMember[]>;tags:TagBinding[];tag_summary?:{tags:TagLabel[];total:number}};
function present(row:Row&{members_json?:string;observation_count?:number;latest_observation?:string|null},at=Date.now()):Archive{const {contacts_json,links_json,members_json,...rest}=row;return {...rest,closed:!!row.closed,deleted:!!row.deleted,update_reminder:archiveReminder({...row,closed:!!row.closed,deleted:!!row.deleted},at),contacts:JSON.parse(contacts_json),links:JSON.parse(links_json),observation_count:row.observation_count??0,latest_observation:row.latest_observation??null,members:JSON.parse(members_json??'[]').map((m:BoundMember)=>({...m,frozen:!!m.frozen})),bindings:{},tags:[]};}
const observationSummary="(SELECT count(*) FROM observations o WHERE o.archive_id=a.id AND o.deleted=0) observation_count,(SELECT substr(v.body,1,240) FROM observations o JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version WHERE o.archive_id=a.id AND o.deleted=0 ORDER BY o.updated_at DESC,o.id DESC LIMIT 1) latest_observation";
const currentMembers="(SELECT json_group_array(json_object('id',m.id,'name',m.name,'frozen',m.frozen)) FROM archive_bindings b JOIN members m ON m.id=b.member_id WHERE b.archive_id=a.id AND b.status=a.status) members_json";

// Archives owns the version/closed transaction boundary used by profile and future content changes.
export class Archives{
 constructor(readonly env:Env,readonly actor:Actor,readonly source:Source){}
 url(archive:{id:string;type:'person'|'org'}){return `${this.env.APP_ORIGIN}${archive.type==='org'?'/organizations':'/'}?archive=${archive.id}`;}
 stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async get(id:string,version?:number,open=false){
  z.uuid().parse(id);const row=await this.stmt(`SELECT a.*,${currentMembers},${observationSummary} FROM archives a WHERE a.id=?`,id).first<Row>();
  if(!row||(row.deleted&&this.actor.role!=='admin'))throw new Failure(404,'NOT_FOUND','档案不存在或无权读取');
  if(row.deleted&&(open||version!==undefined))throw new Failure(409,'ARCHIVE_DELETED','档案已删除，请先恢复档案');
  if(open&&row.closed)throw new Failure(409,'ARCHIVE_CLOSED','档案已关闭，请先核对；修改不能替代显式重新开启');
  if(version!==undefined&&row.version!==version)throw new Failure(409,'VERSION_CONFLICT','档案已被更新，请重新读取后核对');
  const archive=present(row),bindings=await this.stmt('SELECT b.status,m.id,m.name,m.frozen FROM archive_bindings b JOIN members m ON m.id=b.member_id WHERE b.archive_id=? ORDER BY m.name,m.id',id).all<BoundMember&{status:string}>();
  for(const {status,...m} of bindings.results)(archive.bindings[status]??=[]).push({...m,frozen:!!m.frozen});
  return archive;
 }
 guard(id:string,version:number,key:string,open=true){return this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archives WHERE id=? AND version=? AND deleted=0 ${open?'AND closed=0':''}) THEN 1 ELSE 0 END)`,key,id,version);}
 event(id:string,kind:string,before:unknown,after:unknown,at=now(),observationId:string|null=null){return this.stmt('INSERT INTO archive_events(id,archive_id,actor_id,source,kind,before_json,after_json,observation_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),id,this.actor.id,this.source,kind,JSON.stringify(before),JSON.stringify(after),observationId,at);}
 async detail(id:string){const archive=await this.get(id);return {archive:{...archive,url:this.url(archive),tags:await new TagState(this.env,this.actor).list(id,archive.closed||archive.deleted,archive.deleted?archive.deleted_snapshot_version:archive.tag_snapshot_version)}};}
 async list(input:unknown){
  const a=archiveListInput.parse(input),position=archiveCursor(a.before);if(a.deleted)assertAdmin(this.actor);const where=['a.type=?','a.deleted=?'],args:unknown[]=[a.type,a.deleted?1:0],unread=unreadPredicate(this.actor);
  const value='%'+a.query.replace(/[\\%_]/g,'\\$&')+'%',match=`SELECT json_object('observation_id',o.id,'excerpt',substr(v.body,max(1,instr(lower(v.body),lower(?))-60),240)) FROM observations o JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version WHERE o.archive_id=a.id AND o.deleted=0 AND v.body LIKE ? ESCAPE '\\' ORDER BY o.updated_at DESC,o.id DESC LIMIT 1`;
  if(a.query){where.push(`(a.name LIKE ? ESCAPE '\\' OR a.contacts_json LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM observations o JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version WHERE o.archive_id=a.id AND o.deleted=0 AND v.body LIKE ? ESCAPE '\\'))`);args.push(value,value,value);}
  if(a.status){where.push('a.status=?');args.push(a.status);}
  if(a.member_id){where.push('EXISTS(SELECT 1 FROM archive_bindings b WHERE b.archive_id=a.id AND b.status=a.status AND b.member_id=?)');args.push(a.member_id);}
  if(a.closed!=='all')where.push(`a.closed=${a.closed==='closed'?1:0}`);
  if(a.tag_ids.length){
   const ids=[...new Set(a.tag_ids)],definitions=(await this.stmt('SELECT t.id,t.category_id,c.type FROM tags t JOIN tag_categories c ON c.id=t.category_id WHERE t.id IN (SELECT value FROM json_each(?))',JSON.stringify(ids)).all<{id:string;category_id:string;type:string}>()).results;
   if(definitions.length!==ids.length||definitions.some(t=>t.type!==a.type))throw new Failure(400,'TAG_NOT_FOUND','筛选标签不存在或不属于当前档案类型，请重新选择');
   const groups=[...new Set(definitions.map(t=>t.category_id))].map(category=>definitions.filter(t=>t.category_id===category).map(t=>t.id));
   // One JSON parameter also supports 30 independent categories without exceeding D1 bind limits.
   where.push(`NOT EXISTS(SELECT 1 FROM json_each(?) wanted WHERE NOT ((a.closed=0 AND EXISTS(SELECT 1 FROM archive_tags b WHERE b.archive_id=a.id AND b.tag_id IN (SELECT value FROM json_each(wanted.value)) AND ${evidenceVisibilitySql('b.evidence_json')})) OR (a.closed=1 AND EXISTS(SELECT 1 FROM archive_tag_snapshots s WHERE s.archive_id=a.id AND s.close_version=a.tag_snapshot_version AND s.tag_id IN (SELECT value FROM json_each(wanted.value)) AND ${evidenceVisibilitySql("json_extract(s.data_json,'$.evidence')")}))))`);
   args.push(JSON.stringify(groups),this.actor.id,this.actor.role,this.actor.id,this.actor.role);
  }
  const mine="EXISTS(SELECT 1 FROM archive_bindings b WHERE b.archive_id=a.id AND b.status=a.status AND b.member_id=?)";
  const counts=a.before?undefined:await this.stmt(`SELECT count(*) AS 'all',coalesce(sum(CASE WHEN ${mine} THEN 1 ELSE 0 END),0) mine,coalesce(sum(CASE WHEN EXISTS(SELECT 1 FROM archive_events e WHERE e.archive_id=a.id AND ${unread.sql}) THEN 1 ELSE 0 END),0) unread FROM archives a WHERE ${where.join(' AND ')}`,this.actor.id,...unread.args,...args).first<{all:number;mine:number;unread:number}>();
  if(a.scope==='mine'){where.push(mine);args.push(this.actor.id);}
  if(a.scope==='unread'){where.push(`EXISTS(SELECT 1 FROM archive_events e WHERE e.archive_id=a.id AND ${unread.sql})`);args.push(...unread.args);}
  if(position.after){const p=position.after;where.push('(a._priority>? OR (a._priority=? AND (a._sort>? OR (a._sort=? AND a.id<?))))');args.push(p.priority,p.priority,p.sort,p.sort,p.id);}
  const rows=await this.stmt(`${archiveOrderCte} SELECT a.*,${currentMembers},${observationSummary},(SELECT count(*) FROM archive_events e WHERE e.archive_id=a.id AND ${unread.sql}) unread_count,${a.query?'('+match+')':'NULL'} search_match_json FROM ranked a WHERE ${where.join(' AND ')} ORDER BY a._priority ASC,a._sort ASC,a.id DESC LIMIT ?`,position.at,...unread.args,...(a.query?[a.query,value]:[]),...args,a.limit+1).all<Row&{unread_count:number;search_match_json:string|null;_priority:number;_sort:number;_due:number|null;_updated_ms:number}>();
  const page=rows.results.slice(0,a.limit),items=page.map(({search_match_json,_priority,_sort,_due,_updated_ms,...row})=>({...present(row,position.at),unread_count:row.unread_count,search_match:search_match_json?JSON.parse(search_match_json):null})),last=page.at(-1),summaries=await new TagState(this.env,this.actor).summaries(items.map(i=>i.id));
  return {counts:counts?{...counts}:undefined,archives:items.map(item=>{const {tags:_,...summary}=item;return {...summary,url:this.url(item),tag_summary:summaries.get(item.id)??{tags:[],total:0}};}),next_cursor:rows.results.length>a.limit&&last?nextArchiveCursor(position.at,last):null};
 }
 async setDeleted(input:unknown,deleted:boolean){
  const a=archiveDeletionInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:deleted?'archive.delete':'archive.restore',parameters:a,requireAdmin:true},async()=>{
   const old=await this.get(a.id);if(old.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','档案已被更新，请重新读取后核对');
   const changed=old.deleted!==deleted,key=uid(),at=now(),statements=[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archives WHERE id=? AND version=? AND deleted=?) THEN 1 ELSE 0 END)',key,a.id,a.expected_version,old.deleted?1:0)];
   if(changed){
    if(deleted&&!old.closed)statements.push(new TagState(this.env,this.actor).snapshot(a.id,old.version+1));
    statements.push(this.stmt('UPDATE archives SET deleted=?,deleted_at=?,deleted_by=?,deleted_snapshot_version=?,version=version+1,updated_at=? WHERE id=?',deleted?1:0,deleted?at:null,deleted?this.actor.id:null,deleted?(old.closed?old.tag_snapshot_version:old.version+1):null,at,a.id),this.event(a.id,deleted?'archive.deleted':'archive.restored',{deleted:old.deleted},{deleted},at));
   }
   statements.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',key));return {result:{id:a.id,version:old.version+(changed?1:0),deleted,changed,archive_url:this.url(old)},statements};
  });
 }
 async create(input:unknown){const a=archiveCreateInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'archive.create',parameters:{...a,request_id:undefined}},async()=>{
  const id=uid(),at=now(),plan=await this.planBindings(id,a.type,a.status,a.member_ids),closed=isClosedState(a.status);
  return {result:{id,version:1,changed:true,archive_url:this.url({id,type:a.type})},statements:[...plan.guards,this.stmt('INSERT INTO archives(id,type,name,contacts_json,links_json,status,closed,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,a.type,a.name,JSON.stringify(a.contacts),JSON.stringify(a.links),a.status,closed?1:0,this.actor.id,at,at),...plan.bindings,this.event(id,'archive.created',null,{type:a.type,name:a.name,contacts:a.contacts,links:a.links,status:a.status,members:plan.members},at),...(closed?[this.event(id,'archive.closed',null,{status:a.status},at)]:[]),...plan.cleanup]};
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
   const tagState=new TagState(this.env,this.actor),definitionChanges:{tag_id:string;before:TagBinding;after:TagBinding}[]=[];
   if(reopen){const frozen=await tagState.list(a.id,true,old.tag_snapshot_version),current=await tagState.list(a.id);for(const b of frozen){const live=current.find(t=>t.tag_id===b.tag_id);if(live&&(live.definition_version!==b.definition_version||live.category_version!==b.category_version||!live.enabled||!live.category_enabled||live.merged_into))definitionChanges.push({tag_id:b.tag_id,before:b,after:live});}}
   const statements=[this.guard(a.id,a.expected_version,key,!reopen),...plan.guards];
   if(changed){
    statements.push(this.stmt('UPDATE archives SET status=?,closed=?,last_open_status=?,version=version+1,updated_at=? WHERE id=?',a.status,closed?1:0,closed?old.status:old.last_open_status,at,a.id),this.stmt('DELETE FROM archive_bindings WHERE archive_id=? AND status=?',a.id,a.status),...plan.bindings);
    const before={status:old.status,members:old.members},after={status:a.status,members:plan.members};
    statements.push(this.event(a.id,old.status!==a.status?'archive.state_changed':'archive.members_changed',before,after,at));
    if(closed)statements.push(tagState.snapshot(a.id,old.version+1),this.stmt('UPDATE archives SET tag_snapshot_version=? WHERE id=?',old.version+1,a.id),this.event(a.id,'archive.closed',{status:old.status},{status:a.status,tag_snapshot_version:old.version+1},at));
    if(reopen)statements.push(this.event(a.id,'archive.reopened',{status:old.status},{status:a.status},at));
   }
   statements.push(...plan.cleanup,this.stmt('DELETE FROM mutation_guards WHERE id=?',key));return {result:{id:a.id,version:old.version+(changed?1:0),status:a.status,closed,changed,archive_url:this.url(old),definition_changes:definitionChanges},statements};
  });
 }
 async update(input:unknown){const a=archiveUpdateInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'archive.update',parameters:{...a,request_id:undefined}},async()=>{
  const old=await this.get(a.id,a.expected_version,true),key=uid(),before={name:old.name,contacts:old.contacts,links:old.links},after={name:a.name,contacts:a.contacts,links:a.links},changed=JSON.stringify(before)!==JSON.stringify(after),at=now();
  const statements=[this.guard(a.id,a.expected_version,key)];
  if(changed)statements.push(this.stmt('UPDATE archives SET name=?,contacts_json=?,links_json=?,version=version+1,updated_at=? WHERE id=?',a.name,JSON.stringify(a.contacts),JSON.stringify(a.links),at,a.id),this.event(a.id,'archive.profile_changed',before,after,at));
  statements.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',key));return {result:{id:a.id,version:old.version+(changed?1:0),changed,archive_url:this.url(old)},statements};
 });}
 async events(input:unknown){
  const a=z.object({id:z.uuid(),before:z.coerce.number().int().positive().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)}).parse(input);await this.get(a.id);
  const visibility=eventVisibility(this.actor);
  const rows=await this.stmt(`SELECT e.*,(SELECT name FROM members WHERE id=e.actor_id) actor_name FROM archive_events e WHERE archive_id=? AND ${visibility.sql} ${a.before?'AND seq<?':''} ORDER BY seq DESC LIMIT ?`,a.id,...visibility.args,...(a.before?[a.before]:[]),a.limit+1).all<Record<string,unknown>>();
  const events:Record<string,unknown>[]=rows.results.slice(0,a.limit).map(({before_json,after_json,...e})=>({...e,before:before_json?JSON.parse(String(before_json)):null,after:after_json?JSON.parse(String(after_json)):null}));
  const state=new TagState(this.env,this.actor),visible=[];for(const e of events){if(e.kind==='archive.tags_changed'){e.before=await state.filterEvent(e.before);e.after=await state.filterEvent(e.after);if(!(e.before as unknown[]).length&&!(e.after as unknown[]).length)continue;}visible.push(e);}const deliveries=await new Reading(this.env,this.actor).deliver(visible.filter(e=>!e.observation_id).map(e=>({id:String(e.id)})));return {events:visible.map(e=>({...e,reading:deliveries.get(String(e.id))??null})),next_cursor:rows.results.length>a.limit?String(events.at(-1)?.seq):null};
 }
}
