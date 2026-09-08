import {z} from 'zod';
import {assertAdmin} from './credentials.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';

export const CONTRACT_VERSION='0.1.0-2026-09-08';
export type Outcome='success'|'no_change'|'rejected'|'failed'|'unknown';
// Only named business fields may enter request storage. Add fields with each delivered tool.
const fields:Record<string,string[]>={whoami:[],get_usage_guide:['topic'],list_connections:[],revoke_connection:['id']};
export function registerJournalFields(tool:string,names:string[]){fields[tool]=names;}
export function redactText(text:string){
  return text.replace(/cts(?:u)?_[a-f0-9]{64}/gi,'[已移除凭证]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [已移除凭证]')
    .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{16,}|github_pat_[\w_]{16,})\b/g,'[已移除凭证]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,'[已移除凭证]')
    .replace(/((?:password|passwd|密码|令牌|token|authorization|cookie|uploadToken)\s*(?:[=:：]|是)\s*)[^,，;；\r\n]+/gi,'$1[已移除秘密]')
    .replace(/([?&](?:token|signature|secret|key|ticket)=)[^\s&#]+/gi,'$1[已移除秘密]');
}
function scrub(value:unknown,depth=0):unknown{
  if(depth>12)return '[层级过深，未留存]';
  if(typeof value==='string')return redactText(value);
  if(Array.isArray(value))return value.slice(0,200).map(x=>scrub(x,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/(password|secret|authorization|cookie|token|ticket|uploadurl)/i.test(k)).map(([k,v])=>[k,scrub(v,depth+1)]));
  return value;
}
export function safeParameters(tool:string,args:unknown){
  const input=args&&typeof args==='object'?args as Record<string,unknown>:{};
  const selected=Object.fromEntries((fields[tool]??[]).filter(k=>Object.hasOwn(input,k)).map(k=>[k,scrub(input[k])]));
  const value=JSON.stringify(selected);
  return value.length>32000?{json:JSON.stringify({omitted:'请求正文过长，未留存'}),state:'omitted_size'}:{json:value,state:'retained'};
}
export async function journalDiagnostic(env:Env,kind:string){
  console.warn(JSON.stringify({event:'mcp.diagnostic',kind}));
  try{await env.DB.prepare('INSERT INTO mcp_diagnostics(day,kind) VALUES(?,?) ON CONFLICT(day,kind) DO UPDATE SET count=count+1').bind(now().slice(0,10),kind).run();}catch{/* Cloud log remains a body-free signal if D1 is unavailable. */}
}
export type Attempt={id:string;started:number;stored:boolean};
export async function startAttempt(env:Env,actor:Actor,tool:string,args:unknown):Promise<Attempt>{
  const attempt={id:uid(),started:Date.now(),stored:false};
  const safe=safeParameters(tool,args),input=args as Record<string,unknown>|undefined;
  const requestId=typeof input?.request_id==='string'&&z.uuid().safeParse(input.request_id).success?input.request_id:null;
  try{
    const taskId=typeof input?.task_id==='string'&&z.uuid().safeParse(input.task_id).success&&(await env.DB.prepare('SELECT 1 FROM mcp_tasks WHERE id=? AND member_id=?').bind(input.task_id,actor.id).first())?input.task_id:null;
    await env.DB.prepare(`INSERT INTO mcp_calls(id,member_id,credential_id,tool,contract_version,started_at,outcome,request_id,parameters_json,body_state,task_id) VALUES(?,?,?,?,?,?,'unknown',?,?,?,?)`)
      .bind(attempt.id,actor.id,actor.credential_id,tool.slice(0,100),CONTRACT_VERSION,new Date(attempt.started).toISOString(),requestId,safe.json,safe.state,taskId).run();
    attempt.stored=true;
  }catch{await journalDiagnostic(env,'collection_start_failed');}
  return attempt;
}
export async function finishAttempt(env:Env,attempt:Attempt,outcome:Outcome,code:string|null,result:unknown){
  if(!attempt.stored)return;
  // Results are summaries supplied by the business adapter, never full query responses or secrets.
  const serialized=JSON.stringify(scrub(result));
  const taskId=result&&typeof result==='object'&&'task_id' in result&&typeof result.task_id==='string'&&z.uuid().safeParse(result.task_id).success?result.task_id:null;
  try{await env.DB.prepare('UPDATE mcp_calls SET finished_at=?,duration_ms=?,outcome=?,error_code=?,result_json=?,task_id=coalesce(task_id,?) WHERE id=?')
    .bind(now(),Date.now()-attempt.started,outcome,code,serialized.length<=16000?serialized:JSON.stringify({omitted:'结果摘要过长'}),taskId,attempt.id).run();
  }catch{await journalDiagnostic(env,'collection_finish_failed');}
}
export async function listCalls(env:Env,actor:Actor,input:unknown){
  assertAdmin(actor);
  const a=z.object({outcome:z.enum(['success','no_change','rejected','failed','unknown']).optional(),before:z.string().max(150).optional(),from:z.iso.datetime().optional(),to:z.iso.datetime().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)}).parse(input);
  const where:string[]=['started_at>=?'],args:(string|number)[]=[new Date(Date.now()-180*86400000).toISOString()];
  if(a.outcome){where.push('outcome=?');args.push(a.outcome);}
  if(a.from){where.push('started_at>=?');args.push(a.from);}
  if(a.to){where.push('started_at<=?');args.push(a.to);}
  if(a.before){const split=a.before.indexOf('|');if(split>0){where.push('(started_at<? OR (started_at=? AND id<?))');args.push(a.before.slice(0,split),a.before.slice(0,split),a.before.slice(split+1));}}
  const rows=await env.DB.prepare(`SELECT id,member_id,credential_id,tool,contract_version,started_at,finished_at,duration_ms,outcome,error_code,request_id,task_id,body_state,
    (SELECT name FROM members WHERE members.id=mcp_calls.member_id) member_name,
    (SELECT name FROM credentials WHERE credentials.id=mcp_calls.credential_id) connection_name
    FROM mcp_calls ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY started_at DESC,id DESC LIMIT ?`).bind(...args,a.limit+1).all<Record<string,unknown>>();
  const hasMore=rows.results.length>a.limit,items=rows.results.slice(0,a.limit),last=items.at(-1);
  const diagnostics=await env.DB.prepare("SELECT day,kind,count FROM mcp_diagnostics WHERE day>=? ORDER BY day DESC").bind(new Date(Date.now()-30*86400000).toISOString().slice(0,10)).all();
  return {calls:items,next_cursor:hasMore&&last?`${last.started_at}|${last.id}`:null,diagnostics:diagnostics.results,coverage:'尽力采集；服务或存储不可用时可能缺失，未分类的中断保持结果不明。'};
}
export async function getCall(env:Env,actor:Actor,id:string){
  assertAdmin(actor);z.uuid().parse(id);
  const row=await env.DB.prepare('SELECT * FROM mcp_calls WHERE id=? AND started_at>=?').bind(id,new Date(Date.now()-180*86400000).toISOString()).first<Record<string,unknown>>();
  if(!row)throw new Failure(404,'NOT_FOUND','调用记录不存在或已到期清理');
  const bodyExpired=String(row.started_at)<new Date(Date.now()-30*86400000).toISOString();
  return {call:{...row,parameters_json:undefined,result_json:undefined},parameters:!bodyExpired&&row.parameters_json?JSON.parse(String(row.parameters_json)):null,result:!bodyExpired&&row.result_json?JSON.parse(String(row.result_json)):null,body_state:bodyExpired?'expired':row.body_state};
}
export async function cleanupJournal(env:Env,at=Date.now()){
  await env.DB.batch([
    env.DB.prepare("UPDATE mcp_tasks SET purpose=NULL,original_request=NULL,agent_summary=NULL,material_type=NULL,source_material=NULL,source_references_json=NULL,body_state='expired' WHERE created_at<? AND body_state<>'expired'").bind(new Date(at-30*86400000).toISOString()),
    env.DB.prepare('DELETE FROM mcp_tasks WHERE created_at<?').bind(new Date(at-180*86400000).toISOString()),
    env.DB.prepare('DELETE FROM observation_reads WHERE read_at<?').bind(new Date(at-30*86400000).toISOString()),
    env.DB.prepare("UPDATE mcp_calls SET parameters_json=NULL,result_json=NULL,body_state='expired' WHERE started_at<? AND body_state<>'expired'").bind(new Date(at-30*86400000).toISOString()),
    env.DB.prepare('DELETE FROM mcp_calls WHERE started_at<?').bind(new Date(at-180*86400000).toISOString()),
    env.DB.prepare('DELETE FROM mcp_diagnostics WHERE day<?').bind(new Date(at-180*86400000).toISOString().slice(0,10)),
  ]);
}
