import {z} from 'zod';
import {assertAdmin} from './credentials.ts';
import {listCalls,callQueryInput,journalResultMetadata,redactText} from './mcp-journal.ts';
import {type Evidence} from './tag-state.ts';
import {Failure,type Actor,type Env} from './types.ts';

type TaskRow={id:string;member_id:string;member_name:string|null;created_at:string;purpose:string|null;original_request:string|null;agent_summary:string|null;material_type:string|null;source_material:string|null;source_references_json:string|null;body_state:string;archive_id:string|null;reported_model:string|null;original_request_provided:number;source_material_provided:number};
const retainedSince=()=>new Date(Date.now()-180*86400000).toISOString();
const taskSourcesVisible="NOT EXISTS(SELECT 1 FROM json_each(coalesce(t.source_references_json,'[]')) r WHERE json_extract(r.value,'$.observation_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM observations o WHERE o.id=json_extract(r.value,'$.observation_id')))";
const bodySince=()=>new Date(Date.now()-30*86400000).toISOString();
const taskListInput=z.object({...callQueryInput.shape}).omit({task_id:true,association:true}).extend({query:z.string().trim().max(200).default('')}).refine(a=>!a.from||!a.to||a.from<=a.to,'开始时间不能晚于结束时间');
type Artifact={kind:'observation'|'archive'|'tag'|'category';id:string;submitted_version?:number;current_version?:number;name?:string;url?:string;archive_id?:string;deleted?:boolean;available:boolean;changed_since?:boolean};
export class TaskReview {
 constructor(readonly env:Env,readonly actor:Actor){assertAdmin(actor);}
 private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async list(input:unknown){const a=taskListInput.parse(input),where=['t.created_at>=?'],args:unknown[]=[retainedSince()];
  if(a.from){where.push('t.created_at>=?');args.push(a.from);}if(a.to){where.push('t.created_at<=?');args.push(a.to);}
  if(a.query){where.push(taskSourcesVisible);where.push("t.created_at>=? AND t.purpose LIKE ? ESCAPE '\\'");args.push(bodySince(),'%'+a.query.replace(/[\\%_]/g,'\\$&')+'%');}
  if(a.tool||a.outcome){const sub=['c.task_id=t.id'];if(a.tool){sub.push('c.tool=?');args.push(a.tool);}if(a.outcome){sub.push('c.outcome=?');args.push(a.outcome);}where.push('EXISTS(SELECT 1 FROM mcp_calls c WHERE '+sub.join(' AND ')+')');}
  if(a.before){const [time,id]=a.before.split('|');if(!z.iso.datetime().safeParse(time).success||!z.uuid().safeParse(id).success)throw new Failure(400,'INVALID_CURSOR','任务分页位置无效');where.push('(t.created_at<? OR (t.created_at=? AND t.id<?))');args.push(time,time,id);}
  const rows=(await this.stmt(`SELECT t.*,${taskSourcesVisible} sources_visible,(SELECT name FROM members WHERE id=t.member_id) member_name,(SELECT count(*) FROM mcp_calls c WHERE c.task_id=t.id) call_count FROM mcp_tasks t WHERE ${where.join(' AND ')} ORDER BY t.created_at DESC,t.id DESC LIMIT ?`,...args,a.limit+1).all<TaskRow&{call_count:number;sources_visible:number}>()).results;
  const tasks=rows.slice(0,a.limit).map(t=>({id:t.id,member_name:t.member_name,created_at:t.created_at,purpose:t.sources_visible&&t.created_at>=bodySince()&&t.purpose?redactText(t.purpose):null,body_state:t.created_at<bodySince()?'expired':!t.sources_visible?'source_restricted':t.body_state,original_request_state:t.original_request_provided?'provided':'unknown',source_material_state:t.source_material_provided?'provided':'unknown',call_count:t.call_count})),last=tasks.at(-1);
  return {tasks,next_cursor:rows.length>a.limit&&last?`${last.created_at}|${last.id}`:null,scope:'时间按任务创建时间筛选；操作和结果匹配明确关联的调用。没有关联 ID 的调用单独查看，不按成员或时间推测任务。'};
 }
 async detail(input:unknown){const a=z.object({id:z.uuid(),before:z.string().max(150).optional(),limit:z.coerce.number().int().min(1).max(50).default(20)}).parse(input),t=await this.stmt('SELECT t.*,(SELECT name FROM members WHERE id=t.member_id) member_name FROM mcp_tasks t WHERE id=? AND created_at>=?',a.id,retainedSince()).first<TaskRow>();if(!t)throw new Failure(404,'NOT_FOUND','任务不存在或已到期清理');
  const expired=t.created_at<bodySince(),refs:Evidence[]=!expired&&t.source_references_json?JSON.parse(t.source_references_json):[],allowed:Evidence[]=[];
  for(const e of refs){if(!e.observation_id||await this.stmt("SELECT 1 FROM observations WHERE id=? AND (deleted=0 OR author_id=? OR ?='admin')",e.observation_id,this.actor.id,this.actor.role).first())allowed.push({...e,note:redactText(e.note)});}
  // A prose copy may combine several references; never expose a partial source through that copy.
  const restricted=allowed.length!==refs.length,readable=!expired&&!restricted,clean=(v:string|null)=>readable&&v?redactText(v):null;
  const result=await listCalls(this.env,this.actor,{task_id:t.id,limit:a.limit,...(a.before?{before:a.before}:{})});
  const ids=result.calls.map(c=>c.id),records=ids.length?(await this.stmt('SELECT id,tool,result_meta_json FROM mcp_calls WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify(ids)).all<{id:string;tool:string;result_meta_json:string}>()).results:[],artifacts=new Map<string,Artifact>();
  function add(kind:Artifact['kind'],id:unknown,version?:unknown){if(typeof id!=='string'||!z.uuid().safeParse(id).success)return;const key=kind+':'+id,old=artifacts.get(key);artifacts.set(key,{kind,id,available:false,...(typeof version==='number'?{submitted_version:Math.max(old?.submitted_version??0,version)}:old?.submitted_version?{submitted_version:old.submitted_version}:{})});}
  for(const call of records){const m=journalResultMetadata(JSON.parse(call.result_meta_json));
   if(/^(create|update|delete|restore)_observation$/.test(call.tool))add('observation',m.id,m.version);
   else if(['create_archive','update_archive','set_archive_state','reopen_archive'].includes(call.tool))add('archive',m.id,m.version);
   else if(call.tool==='update_archive_tags'){add('archive',m.archive_id,m.version);for(const id of [...(m.added as string[]??[]),...(m.removed as string[]??[])])add('tag',id);}
   else if(call.tool==='create_tag')add('tag',m.id,m.version);else if(call.tool==='create_tag_category')add('category',m.id,m.version);
   else if(call.tool==='apply_tag_definition'||call.tool==='apply_tag_availability')add(m.entity_type==='category'?'category':'tag',m.id,m.version);
   else if(call.tool==='apply_tag_migration'){add('tag',m.from_tag_id);add('tag',m.to_tag_id);for(const row of m.completed as {archive_id:string;version?:number}[]??[])add('archive',row.archive_id,row.version);}
  }
  for(const [key,artifact] of artifacts){if(artifact.kind==='observation'){
    const r=await this.stmt("SELECT o.id,o.archive_id,o.version,o.deleted,a.name,a.type FROM observations o JOIN archives a ON a.id=o.archive_id WHERE o.id=? AND (o.deleted=0 OR o.author_id=? OR ?='admin')",artifact.id,this.actor.id,this.actor.role).first<{archive_id:string;version:number;deleted:number;name:string;type:string}>();if(r)artifacts.set(key,{...artifact,available:true,archive_id:r.archive_id,name:r.name,current_version:r.version,deleted:!!r.deleted,changed_since:artifact.submitted_version!==undefined&&r.version>artifact.submitted_version,url:`${this.env.APP_ORIGIN}${r.type==='org'?'/organizations':'/'}?archive=${r.archive_id}&observation=${artifact.id}`});
   }else if(artifact.kind==='archive'){const r=await this.stmt('SELECT name,type,version FROM archives WHERE id=?',artifact.id).first<{name:string;type:string;version:number}>();if(r)artifacts.set(key,{...artifact,available:true,name:r.name,current_version:r.version,changed_since:artifact.submitted_version!==undefined&&r.version>artifact.submitted_version,url:`${this.env.APP_ORIGIN}${r.type==='org'?'/organizations':'/'}?archive=${artifact.id}`});}
   else{const sql=artifact.kind==='tag'?'SELECT c.name||\'：\'||t.name name,t.version FROM tags t JOIN tag_categories c ON c.id=t.category_id WHERE t.id=?':'SELECT name,version FROM tag_categories WHERE id=?',r=await this.stmt(sql,artifact.id).first<{name:string;version:number}>();if(r)artifacts.set(key,{...artifact,available:true,name:r.name,current_version:r.version,changed_since:artifact.submitted_version!==undefined&&r.version>artifact.submitted_version});}
  }
  return {task:{id:t.id,member_name:t.member_name,created_at:t.created_at,purpose:clean(t.purpose),original_request:clean(t.original_request),agent_summary:clean(t.agent_summary),material_type:clean(t.material_type),source_material:clean(t.source_material),source_references:allowed,body_state:expired?'expired':restricted?'source_restricted':t.body_state,original_request_state:t.original_request_provided?'provided':'unknown',source_material_state:t.source_material_provided?'provided':'unknown',reported_model:clean(t.reported_model),model_state:readable&&t.reported_model?'agent_reported':'unknown'},calls:result.calls,next_cursor:result.next_cursor,artifacts:[...artifacts.values()],artifact_scope:'产物来自本页明确关联调用的结果标识；后续版本变化是事实，不代表原任务质量。'};
 }
 async statistics(input:unknown){const a=callQueryInput.parse(input),from=a.from??new Date(Date.now()-30*86400000).toISOString(),to=a.to??new Date().toISOString(),where=['started_at>=?','started_at<=?'],args:unknown[]=[from,to];if(a.tool){where.push('tool=?');args.push(a.tool);}if(a.outcome){where.push('outcome=?');args.push(a.outcome);}
  const aggregate=`count(*) calls,sum(task_id IS NOT NULL) linked_calls,count(DISTINCT task_id) linked_tasks,sum(body_state='retained' AND started_at>=?) retained_bodies,sum(outcome='success' AND coalesce(json_extract(result_meta_json,'$.changed'),0)=1 AND coalesce(json_extract(result_meta_json,'$.replayed'),0)=0) changed_operations,
   sum(tool='create_observation' AND outcome='success' AND coalesce(json_extract(result_meta_json,'$.changed'),0)=1 AND coalesce(json_extract(result_meta_json,'$.replayed'),0)=0) observations_created,
   sum(tool='create_tag' AND outcome='success' AND coalesce(json_extract(result_meta_json,'$.changed'),0)=1 AND coalesce(json_extract(result_meta_json,'$.replayed'),0)=0) tags_created,
   sum(tool='create_tag' AND outcome IN ('success','no_change') AND coalesce(json_extract(result_meta_json,'$.reused'),0)=1 AND coalesce(json_extract(result_meta_json,'$.replayed'),0)=0) tags_reused,
   sum(CASE WHEN outcome='success' AND coalesce(json_extract(result_meta_json,'$.replayed'),0)=0 THEN coalesce(json_array_length(json_extract(result_meta_json,'$.added')),0) ELSE 0 END) tags_added,
   sum(CASE WHEN outcome='success' AND coalesce(json_extract(result_meta_json,'$.replayed'),0)=0 THEN coalesce(json_array_length(json_extract(result_meta_json,'$.removed')),0) ELSE 0 END) tags_removed`;
  const live=(await this.stmt(`SELECT tool,outcome,${aggregate} FROM mcp_calls WHERE ${where.join(' AND ')} GROUP BY tool,outcome`,bodySince(),...args).all<Record<string,number|string>>()).results;
  const archivedWhere=['day>=?','day<=?'],archivedArgs:unknown[]=[from.slice(0,10),to.slice(0,10)];if(a.tool){archivedWhere.push('tool=?');archivedArgs.push(a.tool);}if(a.outcome){archivedWhere.push('outcome=?');archivedArgs.push(a.outcome);}
  const archived=(await this.stmt(`SELECT * FROM mcp_daily_usage WHERE ${archivedWhere.join(' AND ')} ORDER BY day,tool,outcome`,...archivedArgs).all<Record<string,number|string>>()).results;
  const totals:Record<string,number>={calls:0,linked_calls:0,changed_operations:0,observations_created:0,tags_created:0,tags_reused:0,tags_added:0,tags_removed:0,rejected:0,failed:0,unknown:0};
  for(const row of [...live,...archived]){for(const key of Object.keys(totals))if(key in row)totals[key]+=Number(row[key]??0);if(['rejected','failed','unknown'].includes(String(row.outcome)))totals[String(row.outcome)]+=Number(row.calls);}
  const taskCount=await this.stmt('SELECT count(*) count FROM mcp_tasks WHERE created_at>=? AND created_at<=?',from,to).first<{count:number}>(),oldTasks=await this.stmt('SELECT coalesce(sum(tasks),0) count FROM mcp_daily_tasks WHERE day>=? AND day<=?',from.slice(0,10),to.slice(0,10)).first<{count:number}>();
  const explicit=await this.stmt(`SELECT count(DISTINCT task_id) count FROM mcp_calls WHERE ${where.join(' AND ')}`,...args).first<{count:number}>();
  const tools=(await this.stmt('SELECT DISTINCT tool FROM mcp_calls UNION SELECT DISTINCT tool FROM mcp_daily_usage ORDER BY tool').all<{tool:string}>()).results.map(x=>x.tool);
  const diagnostics=(await this.stmt('SELECT day,kind,count FROM mcp_diagnostics WHERE day>=? AND day<=? ORDER BY day DESC',from.slice(0,10),to.slice(0,10)).all()).results;
  return {from,to,totals,tasks_created:(taskCount?.count??0)+(oldTasks?.count??0),linked_tasks_in_retained_calls:explicit?.count??0,association_coverage:totals.calls?totals.linked_calls/totals.calls:null,tools,by_tool_and_outcome:live,archived_daily:archived,diagnostics,scope:'调用按所选时间、操作和结果筛选；新建任务数按时间单独计数。180 天前仅有 UTC 日汇总，不提供任务身份或正文。',coverage:'仅统计已采集的服务结果；明确重放不重复计为新产物，采集失败或历史字段缺失可能少计。未关联调用不推测任务，数量和后续修改不是质量评分。'};
 }
}
