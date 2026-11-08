import {Resources,resourceInput,resourceDeleteInput,presentResource} from './resources.ts';
import {followUpTaskSql} from './follow-up-tasks.ts';
import {z} from 'zod';
import {command,requestId} from './commands.ts';
import {Failure,now,uid,type Env,type Actor} from './types.ts';
import {Archives} from './archives.ts';
import {Observations} from './observations.ts';
import {buildOverviewPerson,experienceTypes,type ExperienceEvent,type OverviewArchive,type OverviewObservation,type OverviewPlacement,type OverviewResource,type OverviewGap,type OverviewTask,type WorkOverviewData} from '../shared/work-overview.ts';

const purpose=z.enum(experienceTypes.map(t=>t.id) as ['contact','review','onboarding','member','friend']);
const base={id:z.uuid(),expected_version:z.number().int().min(0),request_id:requestId};
const resource=resourceInput,resourceDelete=resourceDeleteInput;
const gap=z.object({...base,entity:z.literal('gap'),purpose,work:z.string().trim().min(1).max(1000),missing:z.string().trim().min(1).max(1000),resolved:z.boolean()}).strict();
const placement=z.object({...base,entity:z.literal('placement'),archive_id:z.uuid(),event_id:z.uuid(),resource_ids:z.array(z.uuid()).max(30),note:z.string().max(3000),usage:z.enum(['planned','active'])}).strict();
const white=z.object({...base,entity:z.literal('white_resource'),observation_id:z.uuid(),resource_id:z.uuid().nullable(),capacity:z.number().int().min(0).max(100000).nullable(),removed:z.boolean().default(false)}).strict();
const need=z.object({...base,entity:z.literal('current_need'),current_need:z.string().max(5000)}).strict();
export const overviewSaveInput=z.discriminatedUnion('entity',[resource,resourceDelete,gap,placement,white,need]);
export type OverviewSaveInput=z.infer<typeof overviewSaveInput>;
const tables={resource:'work_overview_resources',resource_delete:'work_overview_resources',gap:'work_overview_gaps',placement:'work_overview_placements'} as const;
function present(row:Record<string,unknown>,entity:keyof typeof tables){const r={...row};if(entity==='resource'||entity==='resource_delete')return presentResource(row);if(entity==='placement'){r.resource_ids=JSON.parse(String(r.resource_ids_json));delete r.resource_ids_json;}if(entity==='gap')r.resolved=!!r.resolved;return r;}

export class WorkOverview{
 constructor(readonly env:Env,readonly actor:Actor){}
 stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async bounded<T>(sql:string,limit:number,...args:unknown[]){const r=await this.stmt(sql+' LIMIT ?',...args,limit+1).all<T>();if(r.results.length>limit)throw new Failure(409,'OVERVIEW_LIMIT','当前范围过大，请缩小范围后重试');return r.results;}
 async read(input:unknown,asOf?:string):Promise<WorkOverviewData>{
  const q=z.object({type:z.enum(['all','person','org']).default('person')}).parse(input),at=asOf??now();
  const scope=(q.type==='all'?'':'a.type=? AND ')+"a.deleted=0 AND a.closed=0",scopeArgs=q.type==='all'?[]:[q.type];
  const archives=await this.bounded<OverviewArchive>(`SELECT a.id,a.name,a.type,a.status,a.created_at,a.person_role,a.version,a.current_need FROM archives a WHERE ${scope} ORDER BY a.name,a.id`,2000,...scopeArgs);
  const events=await this.bounded<{id:string;archive_id:string;seq:number;kind:string;created_at:string;after_json:string}>(`SELECT e.id,e.archive_id,e.seq,e.kind,e.created_at,e.after_json FROM archive_events e JOIN archives a ON a.id=e.archive_id WHERE ${scope} AND e.kind IN ('archive.created','archive.state_changed','archive.reopened') ORDER BY e.seq`,30000,...scopeArgs);
  const observations=await this.bounded<OverviewObservation>(`SELECT o.id,o.archive_id,o.created_at,o.content_version,(SELECT e.id FROM archive_events e WHERE e.observation_id=o.id AND e.kind='observation.created' ORDER BY e.seq LIMIT 1) event_id,(SELECT e.seq FROM archive_events e WHERE e.observation_id=o.id AND e.kind='observation.created' ORDER BY e.seq LIMIT 1) event_seq,v.occurred_at,substr(v.body,1,300) body,m.name author_name FROM observations o JOIN archives a ON a.id=o.archive_id JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version JOIN members m ON m.id=o.author_id WHERE ${scope} AND o.deleted=0 ORDER BY o.created_at,o.id`,30000,...scopeArgs);
  const tasks=(await this.bounded<OverviewTask>(`SELECT t.id,t.archive_id,t.title,t.owner_id,m.name owner_name,coalesce(m.frozen,0) owner_frozen,t.deadline_at,${followUpTaskSql} follow_up FROM work_tasks t JOIN archives a ON a.id=t.archive_id LEFT JOIN members m ON m.id=t.owner_id WHERE ${scope} AND t.status='open' ORDER BY t.deadline_at,t.id`,10000,...scopeArgs)).map(t=>({...t,follow_up:!!t.follow_up}));
  const placements=(await this.bounded<Record<string,unknown>>(`SELECT p.* FROM work_overview_placements p JOIN archives a ON a.id=p.archive_id WHERE ${scope} ORDER BY p.id`,30000,...scopeArgs)).map(r=>present(r,'placement')) as OverviewPlacement[];
  const resources=(await this.bounded<Record<string,unknown>>('SELECT * FROM work_overview_resources ORDER BY name,id',2000)).map(r=>present(r,'resource')) as OverviewResource[];
  const gaps=(await this.bounded<Record<string,unknown>>('SELECT * FROM work_overview_gaps ORDER BY updated_at DESC,id',2000)).map(r=>present(r,'gap')) as OverviewGap[];
  const parsed:ExperienceEvent[]=events.map(e=>({...e,after:JSON.parse(e.after_json)}));
  const whites=await this.bounded<import('../shared/work-overview.ts').WhiteResource>(`SELECT w.* FROM work_overview_white_resources w JOIN archives a ON a.id=w.archive_id JOIN observations o ON o.id=w.observation_id WHERE ${scope} AND o.deleted=0 ORDER BY w.id`,30000,...scopeArgs);
  return {as_of:at,people:archives.map(a=>buildOverviewPerson(a,parsed,observations,placements,tasks,at)),resources,gaps,white_resources:whites.map(w=>({...w,removed:!!w.removed}))};
 }
 async save(input:unknown){
  const a=overviewSaveInput.parse(input);
  if(a.entity==='resource'||a.entity==='resource_delete')return new Resources(this.env,this.actor).save(a);
  if(a.entity==='white_resource')return this.saveWhite(a);
  if(a.entity==='current_need')return command(this.env,this.actor,{requestId:a.request_id,operation:'work_overview.current_need',parameters:a},async()=>{
   const service=new Archives(this.env,this.actor,'web'),old=await service.get(a.id,a.expected_version,true),key=uid(),at=now(),changed=old.current_need!==a.current_need;
   const statements=[service.guard(old.id,old.version,key)];
   if(changed)statements.push(this.stmt('UPDATE archives SET current_need=?,version=version+1,updated_at=? WHERE id=?',a.current_need,at,old.id),service.event(old.id,'archive.profile_changed',{current_need:old.current_need},{current_need:a.current_need},at));
   statements.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
   return {statements,result:{id:old.id,version:old.version+(changed?1:0),changed}};
  });
  const table=tables[a.entity];
  return command(this.env,this.actor,{requestId:a.request_id,operation:'work_overview.'+a.entity,parameters:a},async()=>{
   const old=await this.stmt(`SELECT * FROM ${table} WHERE id=?`,a.id).first<Record<string,unknown>>();
   if((old?.version??0)!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','内容已更新，请重新打开后保存');
   if(old?.deleted_at)throw new Failure(410,'RESOURCE_DELETED','资源已删除，请刷新目录');
   const key=uid(),at=now(),version=a.expected_version+1;
   const statements=[this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN COALESCE((SELECT version FROM ${table} WHERE id=?),0)=? THEN 1 ELSE 0 END)`,key,a.id,a.expected_version)];
   if(a.entity==='gap')statements.push(this.stmt('INSERT INTO work_overview_gaps(id,version,purpose,work,missing,resolved,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,purpose=excluded.purpose,work=excluded.work,missing=excluded.missing,resolved=excluded.resolved,updated_at=excluded.updated_at',a.id,version,a.purpose,a.work,a.missing,a.resolved?1:0,at));
   else{
    const archive=await new Archives(this.env,this.actor,'web').get(a.archive_id,undefined,true);
    if(old&&(old.archive_id!==a.archive_id||old.event_id!==a.event_id))throw new Failure(400,'PLACEMENT_TARGET_FIXED','阶段记录不能改绑其他档案或经历');
    const event=await this.stmt("SELECT e.id FROM archive_events e LEFT JOIN observations o ON o.id=e.observation_id WHERE e.id=? AND e.archive_id=? AND (e.kind IN ('archive.created','archive.state_changed','archive.reopened') OR (e.kind='observation.created' AND o.archive_id=e.archive_id AND o.deleted=0))",a.event_id,a.archive_id).first();
    if(!event)throw new Failure(400,'INVALID_EXPERIENCE','请选择实际存在且可见的经历或观察');
    const ids=[...new Set(a.resource_ids)],found=ids.length?await this.stmt('SELECT id,active,deleted_at FROM work_overview_resources WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify(ids)).all<{id:string;active:number;deleted_at:string|null}>():{results:[]};
    const previous=old?JSON.parse(String(old.resource_ids_json)) as string[]:[];
    if(found.results.length!==ids.length||found.results.some(r=>(!r.active||r.deleted_at)&&!previous.includes(r.id)))throw new Failure(409,'RESOURCE_UNAVAILABLE','所选资源已停用或不存在');
    const ag=uid();statements.push(new Archives(this.env,this.actor,'web').guard(archive.id,archive.version,ag));
    if(ids.length){const rg=uid();statements.push(this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN (SELECT count(*) FROM work_overview_resources WHERE id IN (SELECT value FROM json_each(?)) AND ((active=1 AND deleted_at IS NULL) OR id IN (SELECT value FROM json_each(?))))=? THEN 1 ELSE 0 END)',rg,JSON.stringify(ids),JSON.stringify(previous),ids.length));statements.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',rg));}
    statements.push(this.stmt('INSERT INTO work_overview_placements(id,version,archive_id,event_id,resource_ids_json,note,usage,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,resource_ids_json=excluded.resource_ids_json,note=excluded.note,usage=excluded.usage,updated_at=excluded.updated_at',a.id,version,a.archive_id,a.event_id,JSON.stringify(ids),a.note,a.usage,at));statements.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',ag));
   }
   const {request_id:_,...data}=a;
   statements.push(this.stmt('INSERT INTO work_overview_history(id,entity_type,entity_id,actor_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)',uid(),a.entity,a.id,this.actor.id,old?JSON.stringify(present(old,a.entity)):null,JSON.stringify({...data,version}),at),this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
   return {statements,result:{id:a.id,version,changed:true}};
  });
 }
 async saveWhite(a:z.infer<typeof white>){
  return command(this.env,this.actor,{requestId:a.request_id,operation:'work_overview.white_resource',parameters:a},async()=>{
   const old=await this.stmt('SELECT * FROM work_overview_white_resources WHERE id=?',a.id).first<import('../shared/work-overview.ts').WhiteResource>();
   if((old?.version??0)!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','记录已更新，请重新打开');
   if(old&&old.observation_id!==a.observation_id)throw new Failure(400,'SOURCE_FIXED','不能更换原观察来源');
   const o=await new Observations(this.env,this.actor,'web').get(a.observation_id),archives=new Archives(this.env,this.actor,'web'),archive=await archives.get(o.archive_id,undefined,true);
   if(o.deleted)throw new Failure(409,'OBSERVATION_DELETED','观察已删除');
   const key=uid(),at=now(),version=a.expected_version+1;
   let eventId=old?.event_id;
   if(!old){
    if(a.resource_id||a.removed)throw new Failure(400,'WHITE_REGISTRATION_REQUIRED','先登记白色资源，再补齐');
    if(await this.stmt('SELECT id FROM work_overview_white_resources WHERE observation_id=?',o.id).first())throw new Failure(409,'WHITE_ALREADY_REGISTERED','此观察已登记，直接补齐已有条目');
    const data=await this.read({type:archive.type}),segment=data.people.find(p=>p.id===archive.id)?.segments.find(s=>s.observations.some(v=>v.id===o.id));
    if(!segment||segment.status!=='人事审核'||segment.placements.some(p=>p.resource_ids.length))throw new Failure(400,'WHITE_NOT_ELIGIBLE','仅可登记人事审核阶段未填写对接资源的已提交观察');
    eventId=segment.id;
   }
   const target=a.resource_id?await this.stmt('SELECT version FROM work_overview_resources WHERE id=? AND ((active=1 AND deleted_at IS NULL) OR id=?)',a.resource_id,old?.resource_id??null).first<{version:number}>():null;
   if(a.resource_id&&!target)throw new Failure(409,'RESOURCE_UNAVAILABLE','资源已停用或不存在');
   const result={id:a.id,version,changed:true},after={...a,archive_id:archive.id,event_id:eventId,content_version:old?.content_version??o.content_version,version};
   const statements=[archives.guard(archive.id,archive.version,key+':archive'),this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN COALESCE((SELECT version FROM work_overview_white_resources WHERE id=?),0)=? THEN 1 ELSE 0 END)',key,a.id,a.expected_version)];
   if(!old)statements.push(this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM work_overview_placements WHERE archive_id=? AND event_id=? AND json_array_length(resource_ids_json)>0) THEN 1 ELSE 0 END)",key+':placement',archive.id,eventId),this.stmt('DELETE FROM mutation_guards WHERE id=?',key+':placement'));
   if(target)statements.push(this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_overview_resources WHERE id=? AND version=? AND ((active=1 AND deleted_at IS NULL) OR id=?)) THEN 1 ELSE 0 END)',key+':resource',a.resource_id,target.version,old?.resource_id??null));
   statements.push(this.stmt('INSERT INTO work_overview_white_resources(id,version,archive_id,event_id,observation_id,content_version,resource_id,capacity,removed,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,resource_id=excluded.resource_id,capacity=excluded.capacity,removed=excluded.removed,updated_at=excluded.updated_at',a.id,version,archive.id,eventId,o.id,after.content_version,a.resource_id,a.capacity,a.removed?1:0,at),this.stmt('INSERT INTO work_overview_history(id,entity_type,entity_id,actor_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)',uid(),'white_resource',a.id,this.actor.id,old?JSON.stringify(old):null,JSON.stringify(after),at),this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?,?)',key,key+':archive',key+':resource'));
   return {statements,result};
  });
 }
}
