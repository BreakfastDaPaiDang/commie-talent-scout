import {followUpTaskSql} from './follow-up-tasks.ts';
import {z} from 'zod';
import {command,requestId} from './commands.ts';
import {Failure,now,uid,type Env,type Actor} from './types.ts';
import {Archives} from './archives.ts';
import {buildOverviewPerson,experienceTypes,type ExperienceEvent,type OverviewArchive,type OverviewObservation,type OverviewPlacement,type OverviewResource,type OverviewGap,type OverviewTask,type WorkOverviewData} from '../shared/work-overview.ts';

const purpose=z.enum(experienceTypes.map(t=>t.id) as ['contact','review','onboarding','member','friend']);
const base={id:z.uuid(),expected_version:z.number().int().min(0),request_id:requestId};
const resource=z.object({...base,entity:z.literal('resource'),name:z.string().trim().min(1).max(120),kind:z.string().trim().min(1).max(60),purposes:z.array(purpose).min(1).max(5),capacity:z.number().int().min(0).max(100000).nullable(),active:z.boolean(),note:z.string().max(3000)}).strict();
const gap=z.object({...base,entity:z.literal('gap'),purpose,work:z.string().trim().min(1).max(1000),missing:z.string().trim().min(1).max(1000),resolved:z.boolean()}).strict();
const placement=z.object({...base,entity:z.literal('placement'),archive_id:z.uuid(),event_id:z.uuid(),resource_ids:z.array(z.uuid()).max(30),note:z.string().max(3000),usage:z.enum(['planned','active'])}).strict();
export const overviewSaveInput=z.discriminatedUnion('entity',[resource,gap,placement]);
export type OverviewSaveInput=z.infer<typeof overviewSaveInput>;
const tables={resource:'work_overview_resources',gap:'work_overview_gaps',placement:'work_overview_placements'} as const;
function present(row:Record<string,unknown>,entity:keyof typeof tables){const r={...row};if(entity==='resource'){r.purposes=JSON.parse(String(r.purposes_json));delete r.purposes_json;r.active=!!r.active;}if(entity==='placement'){r.resource_ids=JSON.parse(String(r.resource_ids_json));delete r.resource_ids_json;}if(entity==='gap')r.resolved=!!r.resolved;return r;}

export class WorkOverview{
 constructor(readonly env:Env,readonly actor:Actor){}
 stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async bounded<T>(sql:string,limit:number,...args:unknown[]){const r=await this.stmt(sql+' LIMIT ?',...args,limit+1).all<T>();if(r.results.length>limit)throw new Failure(409,'OVERVIEW_LIMIT','当前范围过大，请缩小范围后重试');return r.results;}
 async read(input:unknown):Promise<WorkOverviewData>{
  const q=z.object({type:z.enum(['person','org']).default('person')}).parse(input),at=now();
  const scope="a.type=? AND a.deleted=0 AND a.closed=0";
  const archives=await this.bounded<OverviewArchive>(`SELECT a.id,a.name,a.type,a.status,a.created_at,a.person_role FROM archives a WHERE ${scope} ORDER BY a.name,a.id`,2000,q.type);
  const events=await this.bounded<{id:string;archive_id:string;seq:number;kind:string;created_at:string;after_json:string}>(`SELECT e.id,e.archive_id,e.seq,e.kind,e.created_at,e.after_json FROM archive_events e JOIN archives a ON a.id=e.archive_id WHERE ${scope} AND e.kind IN ('archive.created','archive.state_changed','archive.reopened') ORDER BY e.seq`,30000,q.type);
  const observations=await this.bounded<OverviewObservation>(`SELECT o.id,o.archive_id,o.created_at,substr(v.body,1,300) body,m.name author_name FROM observations o JOIN archives a ON a.id=o.archive_id JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version JOIN members m ON m.id=o.author_id WHERE ${scope} AND o.deleted=0 ORDER BY o.created_at,o.id`,30000,q.type);
  const tasks=await this.bounded<OverviewTask>(`SELECT t.id,t.archive_id,t.title,t.owner_id,m.name owner_name,coalesce(m.frozen,0) owner_frozen,t.deadline_at FROM work_tasks t JOIN archives a ON a.id=t.archive_id LEFT JOIN members m ON m.id=t.owner_id WHERE ${scope} AND t.status='open' AND ${followUpTaskSql} ORDER BY t.deadline_at,t.id`,10000,q.type);
  const placements=(await this.bounded<Record<string,unknown>>(`SELECT p.* FROM work_overview_placements p JOIN archives a ON a.id=p.archive_id WHERE ${scope} ORDER BY p.id`,30000,q.type)).map(r=>present(r,'placement')) as OverviewPlacement[];
  const resources=(await this.bounded<Record<string,unknown>>('SELECT * FROM work_overview_resources ORDER BY name,id',2000)).map(r=>present(r,'resource')) as OverviewResource[];
  const gaps=(await this.bounded<Record<string,unknown>>('SELECT * FROM work_overview_gaps ORDER BY updated_at DESC,id',2000)).map(r=>present(r,'gap')) as OverviewGap[];
  const parsed:ExperienceEvent[]=events.map(e=>({...e,after:JSON.parse(e.after_json)}));
  return {as_of:at,people:archives.map(a=>buildOverviewPerson(a,parsed,observations,placements,tasks,at)),resources,gaps};
 }
 async save(input:unknown){
  const a=overviewSaveInput.parse(input),table=tables[a.entity];
  return command(this.env,this.actor,{requestId:a.request_id,operation:'work_overview.'+a.entity,parameters:a},async()=>{
   const old=await this.stmt(`SELECT * FROM ${table} WHERE id=?`,a.id).first<Record<string,unknown>>();
   if((old?.version??0)!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','内容已更新，请重新打开后保存');
   const key=uid(),at=now(),version=a.expected_version+1;
   const statements=[this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN COALESCE((SELECT version FROM ${table} WHERE id=?),0)=? THEN 1 ELSE 0 END)`,key,a.id,a.expected_version)];
   if(a.entity==='resource'){
    const purposes=[...new Set(a.purposes)].sort();
    statements.push(this.stmt('INSERT INTO work_overview_resources(id,version,name,kind,purposes_json,capacity,active,note,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,name=excluded.name,kind=excluded.kind,purposes_json=excluded.purposes_json,capacity=excluded.capacity,active=excluded.active,note=excluded.note,updated_at=excluded.updated_at',a.id,version,a.name,a.kind,JSON.stringify(purposes),a.capacity,a.active?1:0,a.note,at));
   }else if(a.entity==='gap')statements.push(this.stmt('INSERT INTO work_overview_gaps(id,version,purpose,work,missing,resolved,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,purpose=excluded.purpose,work=excluded.work,missing=excluded.missing,resolved=excluded.resolved,updated_at=excluded.updated_at',a.id,version,a.purpose,a.work,a.missing,a.resolved?1:0,at));
   else{
    const archive=await new Archives(this.env,this.actor,'web').get(a.archive_id,undefined,true);
    if(old&&(old.archive_id!==a.archive_id||old.event_id!==a.event_id))throw new Failure(400,'PLACEMENT_TARGET_FIXED','阶段记录不能改绑其他档案或经历');
    const event=await this.stmt("SELECT id FROM archive_events WHERE id=? AND archive_id=? AND kind IN ('archive.created','archive.state_changed','archive.reopened')",a.event_id,a.archive_id).first();
    if(!event)throw new Failure(400,'INVALID_EXPERIENCE','请选择实际存在的经历');
    const ids=[...new Set(a.resource_ids)],found=ids.length?await this.stmt('SELECT id,active FROM work_overview_resources WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify(ids)).all<{id:string;active:number}>():{results:[]};
    const previous=old?JSON.parse(String(old.resource_ids_json)) as string[]:[];
    if(found.results.length!==ids.length||found.results.some(r=>!r.active&&!previous.includes(r.id)))throw new Failure(409,'RESOURCE_UNAVAILABLE','所选资源已停用或不存在');
    const ag=uid();statements.push(new Archives(this.env,this.actor,'web').guard(archive.id,archive.version,ag));
    if(ids.length){const rg=uid();statements.push(this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN (SELECT count(*) FROM work_overview_resources WHERE id IN (SELECT value FROM json_each(?)) AND (active=1 OR id IN (SELECT value FROM json_each(?))))=? THEN 1 ELSE 0 END)',rg,JSON.stringify(ids),JSON.stringify(previous),ids.length));statements.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',rg));}
    statements.push(this.stmt('INSERT INTO work_overview_placements(id,version,archive_id,event_id,resource_ids_json,note,usage,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,resource_ids_json=excluded.resource_ids_json,note=excluded.note,usage=excluded.usage,updated_at=excluded.updated_at',a.id,version,a.archive_id,a.event_id,JSON.stringify(ids),a.note,a.usage,at));statements.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',ag));
   }
   const {request_id:_,...data}=a;
   statements.push(this.stmt('INSERT INTO work_overview_history(id,entity_type,entity_id,actor_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)',uid(),a.entity,a.id,this.actor.id,old?JSON.stringify(present(old,a.entity)):null,JSON.stringify({...data,version}),at),this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
   return {statements,result:{id:a.id,version,changed:true}};
  });
 }
}
