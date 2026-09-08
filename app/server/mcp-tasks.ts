import {z} from 'zod';
import {command,requestId} from './commands.ts';
import {redactText,registerJournalFields} from './mcp-journal.ts';
import {TagState,evidenceInput} from './tag-state.ts';
import {now,uid,type Actor,type Env} from './types.ts';
export const taskContextInput=z.object({purpose:z.string().trim().min(1).max(500),original_request:z.string().max(10000).optional(),agent_summary:z.string().max(5000).optional(),material_type:z.string().max(100).optional(),source_material:z.string().max(100000).optional(),archive_id:z.uuid().optional(),source_references:z.array(evidenceInput).max(30).default([]),request_id:requestId}).strict();
registerJournalFields('record_task_context',['purpose','original_request','agent_summary','material_type','archive_id','source_references','request_id']);
export async function recordTaskContext(env:Env,actor:Actor,input:unknown){const a=taskContextInput.parse(input);return command(env,actor,{requestId:a.request_id,operation:'task.context',parameters:{...a,request_id:undefined}},async()=>{
 if(a.source_references.length){z.uuid().parse(a.archive_id);await new TagState(env,actor).validateEvidence(a.source_references,a.archive_id!,true);}
 const id=uid();return {result:{task_id:id,changed:true,original_request_state:a.original_request?'provided':'unknown',source_material_state:a.source_material?'provided':'unknown'},statements:[env.DB.prepare('INSERT INTO mcp_tasks(id,member_id,created_at,purpose,original_request,agent_summary,material_type,source_material,source_references_json) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,actor.id,now(),redactText(a.purpose),a.original_request?redactText(a.original_request):null,a.agent_summary?redactText(a.agent_summary):null,a.material_type?redactText(a.material_type):null,a.source_material?redactText(a.source_material):null,JSON.stringify(a.source_references.map(e=>({...e,note:redactText(e.note)}))))]};
});}
export const taskIdSchema=z.uuid().optional().describe('可选的本次任务关联 ID，来自 record_task_context。未知可省略，不按相近调用时间推测任务。');
export function businessInput<T extends object>(input:T):Omit<T,'task_id'>{const {task_id:_,...value}=input as T&{task_id?:string};return value;}
