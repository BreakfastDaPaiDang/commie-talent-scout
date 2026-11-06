import {z} from 'zod';
import {Failure,uid,type Actor,type Env} from './types.ts';
import type {ArchiveResource,ResourceEntry,ResourceValue,ResourceReference} from '../shared/archive-resources.ts';
export const resourceValueInput=z.object({id:z.uuid(),name:z.string().trim().min(1).max(120),type:z.string().trim().min(1).max(60),note:z.string().trim().max(3000).default(''),archive_id:z.uuid().nullable().default(null),usage:z.enum(['available','planned','active']).default('available')}).strict();
const preserved=z.object({id:z.uuid(),restricted:z.literal(true)}).strict();
export const archiveResourcesInput=z.array(z.union([resourceValueInput,preserved])).max(30).refine(a=>new Set(a.map(r=>r.id)).size===a.length,'同一资源条目不能重复');

export async function projectResources(env:Env,values:ResourceValue[]):Promise<ResourceEntry[]>{
 const ids=[...new Set(values.flatMap(r=>r.archive_id?[r.archive_id]:[]))];
 if(!ids.length)return values.map(r=>({...r,linked_archive:null}));
 const byId=new Map<string,ResourceReference>();
 for(let offset=0;offset<ids.length;offset+=500){const part=ids.slice(offset,offset+500),targets=await env.DB.prepare('SELECT id,name,type,status,person_role,closed FROM archives WHERE id IN(SELECT value FROM json_each(?)) AND deleted=0').bind(JSON.stringify(part)).all<ResourceReference>();for(const t of targets.results)byId.set(t.id,{...t,closed:!!t.closed});}
 return values.map(r=>r.archive_id&&!byId.has(r.archive_id)?{id:r.id,restricted:true}:{...r,linked_archive:r.archive_id?byId.get(r.archive_id)!:null});
}

export async function projectResourceEvents(env:Env,events:{before:unknown;after:unknown}[]){
 const payloads=events.flatMap(e=>[e.before,e.after]).filter((v):v is {resources:ResourceValue[]}=>!!v&&typeof v==='object'&&Array.isArray((v as {resources?:unknown}).resources));
 const projected=await projectResources(env,payloads.flatMap(p=>p.resources));let offset=0;
 for(const payload of payloads){const length=payload.resources.length;(payload as {resources:ResourceEntry[]}).resources=projected.slice(offset,offset+length);offset+=length;}
}

/** Preserve unreadable references by opaque entry ID; never accept a newly guessed hidden target. */
export async function prepareResources(env:Env,actor:Actor,input:z.infer<typeof archiveResourcesInput>,old:ResourceValue[]=[]){
 const values:ResourceValue[]=[],visibleIds=new Set<string>();
 for(const entry of input){
  const previous=old.find(r=>r.id===entry.id);
  if('restricted' in entry){if(!previous)throw new Failure(400,'INVALID_RESOURCE','不可见资源只能保留原有条目');values.push(previous);continue;}
  if(entry.archive_id){
   const target=await env.DB.prepare('SELECT id FROM archives WHERE id=? AND deleted=0').bind(entry.archive_id).first();
   if(!target)throw new Failure(404,'RESOURCE_ARCHIVE_UNAVAILABLE','关联档案不存在或不可用，请重新选择');
   visibleIds.add(entry.archive_id);
  }
  values.push(entry);
 }
 const key=uid(),ids=[...visibleIds];
 const guards=ids.length?[env.DB.prepare(`INSERT INTO mutation_guards VALUES(?,CASE WHEN (SELECT count(*) FROM archives WHERE deleted=0 AND id IN(${ids.map(()=>'?').join(',')}))=? THEN 1 ELSE 0 END)`).bind(key,...ids,ids.length)]:[];
 const cleanup=ids.length?[env.DB.prepare('DELETE FROM mutation_guards WHERE id=?').bind(key)]:[];
 return {values,guards,cleanup};
}
