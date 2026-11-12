import {z} from 'zod';
import {command,requestId} from './commands.ts';
import {Failure,now,uid,type Env,type Actor} from './types.ts';
import {resourcePurposes,type Resource} from '../shared/resources.ts';
import {catalogMode,catalogCall} from './catalog-bridge.ts';
import {emptyCatalogContent} from '../shared/catalog.ts';

const base={id:z.uuid(),expected_version:z.number().int().min(0),request_id:requestId};
export const resourceInput=z.object({...base,entity:z.literal('resource'),name:z.string().trim().min(1).max(120),kind:z.string().trim().max(60).default(''),purposes:z.array(z.string().trim().min(1).max(80)).max(30).default([]),capacity:z.number().int().min(0).max(100000).nullable().default(null),active:z.boolean().default(true),note:z.string().max(3000).default('')}).strict();
export const resourceDeleteInput=z.object({...base,entity:z.literal('resource_delete')}).strict();
const saveInput=z.discriminatedUnion('entity',[resourceInput,resourceDeleteInput]);
export function presentResource(row:Record<string,unknown>):Resource{
 return {id:String(row.id),version:Number(row.version),name:String(row.name),kind:String(row.kind),purposes:resourcePurposes(JSON.parse(String(row.purposes_json))),capacity:row.capacity===null?null:Number(row.capacity),active:!!row.active,deleted:!!row.deleted_at,note:String(row.note)};
}
/** Shared catalog; no archive, personnel stage or observation is required. */
export class Resources{
 constructor(readonly env:Env,readonly actor:Actor){}
 stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async independent(){return await catalogMode(this.env)==='independent';}
 async all():Promise<Resource[]>{
  if(await this.independent())return (await catalogCall<{resources:Resource[]}>(this.env,this.actor,'/resources')).resources;
  const rows=await this.stmt('SELECT * FROM work_overview_resources ORDER BY name,id LIMIT 2001').all<Record<string,unknown>>();if(rows.results.length>2000)throw new Failure(409,'RESOURCE_LIMIT','资源目录过大');return rows.results.map(presentResource);
 }
 async selected(ids:string[]){const wanted=new Set(ids);return (await this.all()).filter(r=>wanted.has(r.id));}
 reference(id:string){return this.stmt("INSERT OR IGNORE INTO work_overview_resources(id,version,name,kind,purposes_json,capacity,active,note,updated_at) VALUES(?,0,'','','[]',NULL,0,'',?)",id,now());}
 async list(input:unknown={}){
  const q=z.object({search:z.string().trim().max(100).default('')}).parse(input);
  if(await this.independent()){const search=q.search.toLowerCase();return {resources:(await this.all()).filter(r=>!r.deleted&&[r.name,r.kind,...r.purposes,r.note].join(' ').toLowerCase().includes(search))};}
  const rows=await this.stmt("SELECT * FROM work_overview_resources WHERE deleted_at IS NULL AND instr(lower(name||' '||kind||' '||coalesce((SELECT group_concat(CASE value WHEN 'contact' THEN '接触' WHEN 'review' THEN '审核' WHEN 'onboarding' THEN '对接' WHEN 'member' THEN '社员' WHEN 'friend' THEN '社外联系' ELSE value END,' ') FROM json_each(purposes_json)),'')||' '||note),lower(?))>0 ORDER BY name,id LIMIT 2001",q.search).all<Record<string,unknown>>();
  if(rows.results.length>2000)throw new Failure(409,'RESOURCE_LIMIT','匹配资源过多，请输入名称或用途缩小范围');
  return {resources:rows.results.map(presentResource)};
 }
 async save(input:unknown){
  const a=saveInput.parse(input);
  const mode=await catalogMode(this.env);
  if(mode==='migrating')throw new Failure(503,'RESOURCE_MIGRATING','资源目录正在迁移，请稍后重试');
  if(mode==='independent'){
   if(a.entity==='resource_delete'||a.expected_version!==0)throw new Failure(409,'RESOURCE_ISSUE_REQUIRED','资源以生产资源库为准，请在那里提交修订 issue');
   return catalogCall(this.env,this.actor,'/entries',{request_id:a.request_id,id:a.id,record_kind:'resource',content:{...emptyCatalogContent(),name:a.name,kind:a.kind,purposes:a.purposes,capacity:a.capacity,active:a.active,note:a.note,owner_id:this.actor.id}});
  }
  // Retain receipt identity for existing clients while both routes use this service.
  return command(this.env,this.actor,{requestId:a.request_id,operation:'work_overview.'+a.entity,parameters:a},async()=>{
   const old=await this.stmt('SELECT * FROM work_overview_resources WHERE id=?',a.id).first<Record<string,unknown>>();
   if((old?.version??0)!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','资源已更新，请重新打开后保存');
   if(old?.deleted_at)throw new Failure(410,'RESOURCE_DELETED','资源已删除，请刷新目录');
   if(a.entity==='resource_delete'&&!old)throw new Failure(404,'NOT_FOUND','资源不存在');
   const key=uid(),at=now(),version=a.expected_version+1;
   const statements=[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN COALESCE((SELECT version FROM work_overview_resources WHERE id=?),0)=? THEN 1 ELSE 0 END)',key,a.id,a.expected_version)];
   if(a.entity==='resource_delete')statements.push(this.stmt('UPDATE work_overview_resources SET deleted_at=?,active=0,version=?,updated_at=? WHERE id=?',at,version,at,a.id));
   else statements.push(this.stmt('INSERT INTO work_overview_resources(id,version,name,kind,purposes_json,capacity,active,note,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,name=excluded.name,kind=excluded.kind,purposes_json=excluded.purposes_json,capacity=excluded.capacity,active=excluded.active,note=excluded.note,updated_at=excluded.updated_at',a.id,version,a.name,a.kind,JSON.stringify(resourcePurposes(a.purposes).sort()),a.capacity,a.active?1:0,a.note,at));
   const {request_id:_,...data}=a;
   statements.push(this.stmt('INSERT INTO work_overview_history(id,entity_type,entity_id,actor_id,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)',uid(),a.entity,a.id,this.actor.id,old?JSON.stringify(presentResource(old)):null,JSON.stringify(a.entity==='resource_delete'?{...presentResource(old!),deleted:true,active:false,version}:{...data,purposes:resourcePurposes(a.purposes),version}),at),this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
   return {statements,result:{id:a.id,version,changed:true}};
  });
 }
}
