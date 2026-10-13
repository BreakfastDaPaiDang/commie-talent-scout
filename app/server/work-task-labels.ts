import {z} from 'zod';
import {command,requestId,type Source} from './commands.ts';
import {taskLabelKey,taskLabelKeys,taskLabelDisplay} from '../rules/task-labels.ts';
import {now,type Actor,type Env} from './types.ts';
export const taskLabelSearchInput=z.object({query:z.string().trim().max(80).default(''),offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(30)});
export const taskLabelCreateInput=z.object({name:z.string().trim().min(1).max(80),request_id:requestId}).strict();
export class WorkTaskLabels{
 constructor(private env:Env,private actor:Actor,private source:Source){}
 async list(input:unknown={}){
  const a=taskLabelSearchInput.parse(input);
  const rows=await this.env.DB.prepare(`WITH counts AS (
   SELECT l.key,l.name,l.builtin,l.created_by,count(DISTINCT t.id) usage_count FROM work_task_labels l
   LEFT JOIN work_tasks t ON EXISTS(SELECT 1 FROM json_each(t.labels_json) j WHERE trim(j.value)=l.key COLLATE NOCASE OR trim(j.value)=l.name COLLATE NOCASE)
    AND (t.archive_id IS NULL OR EXISTS(SELECT 1 FROM archives ar WHERE ar.id=t.archive_id AND (ar.deleted=0 OR ?='admin')))
   GROUP BY l.key
  ) SELECT key,name,usage_count FROM counts WHERE (builtin=1 OR created_by IS NOT NULL OR usage_count>0)
   AND instr(lower(name),lower(?))>0 ORDER BY usage_count DESC,name,key LIMIT ? OFFSET ?`)
   .bind(this.actor.role,a.query,a.limit+1,a.offset).all<{key:string;name:string;usage_count:number}>();
  return {labels:rows.results.slice(0,a.limit),next_offset:rows.results.length>a.limit?a.offset+a.limit:null};
 }
 async create(input:unknown){
  const a=taskLabelCreateInput.parse(input),name=taskLabelDisplay(a.name.normalize('NFKC')),key=taskLabelKey(name);
  return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task_label.create',parameters:{name}},async()=>{
   const existing=await this.env.DB.prepare('SELECT key,name,created_by,builtin FROM work_task_labels WHERE key=? OR name=? COLLATE NOCASE').bind(key,name).first<{key:string;name:string;created_by:string|null;builtin:number}>();
   // Explicit creation makes a formerly imported label reusable without disclosing its tasks.
   return {result:{key:existing?.key??key,name:existing?.name??name,changed:!existing||(!existing.builtin&&!existing.created_by)},statements:[this.env.DB.prepare('INSERT INTO work_task_labels(key,name,created_by,created_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET created_by=COALESCE(work_task_labels.created_by,excluded.created_by)').bind(existing?.key??key,existing?.name??name,this.actor.id,now())]};
  });
 }
 // Old MCP clients may supply fresh names in labels. Keep that explicit-write contract,
 // but put every new label in the same catalog in the task's own transaction.
 prepare(values:readonly string[]){
  const keys=taskLabelKeys(values),at=now();
  return {keys,statements:keys.map(key=>this.env.DB.prepare('INSERT OR IGNORE INTO work_task_labels(key,name,created_by,created_at) VALUES(?,?,?,?)').bind(key,taskLabelDisplay(values.find(value=>taskLabelKey(value)===key)!),this.actor.id,at))};
 }
 async names(values:readonly string[]){
  const keys=taskLabelKeys(values);if(!keys.length)return new Map<string,string>();
  const rows=await this.env.DB.prepare('SELECT key,name FROM work_task_labels WHERE key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all<{key:string;name:string}>();
  return new Map(rows.results.map(row=>[row.key,row.name]));
 }
}
