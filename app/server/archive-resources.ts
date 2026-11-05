import {z} from 'zod';
import {Failure,uid,type Actor,type Env} from './types.ts';
import type {ArchiveResource,ResourceEntry,ResourceValue,ResourceReference,InternalResourceReference} from '../shared/archive-resources.ts';
export const resourceValueInput=z.object({id:z.uuid(),name:z.string().trim().min(1).max(120),type:z.string().trim().min(1).max(60),note:z.string().trim().max(3000).default(''),archive_id:z.uuid().nullable().default(null),internal_resource_id:z.uuid().nullable().optional(),usage:z.enum(['available','planned','active']).default('available')}).strict();
const preserved=z.object({id:z.uuid(),restricted:z.literal(true)}).strict();
export const archiveResourcesInput=z.array(z.union([resourceValueInput,preserved])).max(30).refine(a=>new Set(a.map(r=>r.id)).size===a.length,'同一资源条目不能重复');

export async function projectResources(env:Env,values:ResourceValue[]):Promise<ResourceEntry[]>{
 const ids=[...new Set(values.flatMap(r=>r.archive_id?[r.archive_id]:[]))];
 const byId=new Map<string,ResourceReference>();
 for(let offset=0;offset<ids.length;offset+=500){const part=ids.slice(offset,offset+500),targets=await env.DB.prepare('SELECT id,name,type,status,person_role,closed FROM archives WHERE id IN(SELECT value FROM json_each(?)) AND deleted=0').bind(JSON.stringify(part)).all<ResourceReference>();for(const t of targets.results)byId.set(t.id,{...t,closed:!!t.closed});}
 const internalIds=[...new Set(values.flatMap(r=>r.internal_resource_id?[r.internal_resource_id]:[]))],internal=new Map<string,InternalResourceReference>();
 for(let offset=0;offset<internalIds.length;offset+=500){const found=await env.DB.prepare('SELECT id,name,type,status,stages_json,capacity FROM internal_resources WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(internalIds.slice(offset,offset+500))).all<InternalResourceReference&{stages_json:string}>();for(const r of found.results){const {stages_json,...rest}=r;internal.set(r.id,{...rest,stage_ids:JSON.parse(stages_json)});}}
 return values.map(r=>r.archive_id&&!byId.has(r.archive_id)?{id:r.id,restricted:true}:{...r,legacy:!r.internal_resource_id,internal_resource:r.internal_resource_id?internal.get(r.internal_resource_id)??null:null,linked_archive:r.archive_id?byId.get(r.archive_id)!:null});
}

export async function projectResourceEvents(env:Env,events:{before:unknown;after:unknown}[]){
 const payloads=events.flatMap(e=>[e.before,e.after]).filter((v):v is {resources:ResourceValue[]}=>!!v&&typeof v==='object'&&Array.isArray((v as {resources?:unknown}).resources));
 const projected=await projectResources(env,payloads.flatMap(p=>p.resources));let offset=0;
 for(const payload of payloads){const length=payload.resources.length;(payload as {resources:ResourceEntry[]}).resources=projected.slice(offset,offset+length);offset+=length;}
}

/** Preserve unreadable references by opaque entry ID; never accept a newly guessed hidden target. */
export async function prepareResources(env:Env,actor:Actor,input:z.infer<typeof archiveResourcesInput>,old:ResourceValue[]=[]){
 const values:ResourceValue[]=[],internalIds=new Set<string>(),freshInternalIds=new Set<string>();
 for(const entry of input){
  const previous=old.find(r=>r.id===entry.id);
  if('restricted' in entry){if(!previous)throw new Failure(400,'INVALID_RESOURCE','不可见资源只能保留原有条目');values.push(previous);continue;}
  if(!entry.internal_resource_id){
   const normalize=(r:ResourceValue)=>JSON.stringify([r.id,r.name,r.type,r.note,r.archive_id,r.usage]);
   if(!previous||previous.internal_resource_id||normalize(entry)!==normalize(previous))throw new Failure(400,'INTERNAL_RESOURCE_REQUIRED','请先登记真实的社内承接资源，再关联到档案');
   values.push(previous);continue;
  }
  const resource=await env.DB.prepare('SELECT id,name,type,status FROM internal_resources WHERE id=?').bind(entry.internal_resource_id).first<{id:string;name:string;type:string;status:string}>();
  if(!resource||(resource.status==='archived'&&previous?.internal_resource_id!==resource.id))throw new Failure(409,'INTERNAL_RESOURCE_UNAVAILABLE','所选社内资源不存在或已停用');
  if(entry.archive_id)throw new Failure(400,'INVALID_RESOURCE_CONTEXT','社内资源安排请使用已登记的社内资源，不关联外部接触档案');
  internalIds.add(resource.id);if(previous?.internal_resource_id!==resource.id)freshInternalIds.add(resource.id);
  values.push({...entry,name:previous?.internal_resource_id===resource.id?previous.name:resource.name,type:previous?.internal_resource_id===resource.id?previous.type:resource.type});
 }
 const guards:D1PreparedStatement[]=[],cleanup:D1PreparedStatement[]=[];
 if(internalIds.size){const internalKey=uid();guards.push(env.DB.prepare('INSERT INTO mutation_guards VALUES(?,CASE WHEN (SELECT count(*) FROM internal_resources WHERE id IN(SELECT value FROM json_each(?)))=? AND NOT EXISTS(SELECT 1 FROM internal_resources WHERE id IN(SELECT value FROM json_each(?)) AND status=\'archived\') THEN 1 ELSE 0 END)').bind(internalKey,JSON.stringify([...internalIds]),internalIds.size,JSON.stringify([...freshInternalIds])));cleanup.push(env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(internalKey));}
 return {values,guards,cleanup};
}
