import {z} from 'zod';
import {WorkTasks,workTaskCreateInput,workTaskClaimInput,workTaskAssignInput,workTaskCompleteInput,workTaskReleaseInput} from './work-tasks.ts';
import {registerJournalFields} from './mcp-journal.ts';
import type {McpReply} from './mcp-members.ts';
import type {Actor,Env} from './types.ts';

export const workTaskToolNames=['list_work_tasks','create_work_task','claim_work_task','complete_work_task','release_work_task','assign_work_task'];
registerJournalFields('list_work_tasks',['scope','archive_id','limit']);
registerJournalFields('create_work_task',['archive_id','kind','title','purpose','delivery','deadline_at','source','request_id']);
registerJournalFields('claim_work_task',['id','expected_version','request_id']);
registerJournalFields('complete_work_task',['id','expected_version','result_kind','result_text','request_id']);
registerJournalFields('release_work_task',['id','expected_version','deadline_at','reason','request_id']);
registerJournalFields('assign_work_task',['id','member_id','expected_version','reason','request_id']);
export const workTaskGuides=['工作任务与 Agent 的任务审查记录分开；创建明确类型的工作任务后，系统只向符合本人倾向的活跃成员推送，不直接分配责任。','成员仍可从全组看板主动领取；管理员队列用于查看无人匹配或推送后未领取的开启任务。'];
export function registerWorkTaskTools(server:any,env:Env,actor:Actor,reply:McpReply){
  const service=new WorkTasks(env,actor,'mcp');
  server.registerTool('list_work_tasks',{description:'查看工作任务看板。scope=recommended 只看按本人倾向推荐的未领取任务，scope=mine 看本人已领取任务，scope=admin 仅管理员查看待处理队列。',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:z.object({scope:z.enum(['all','recommended','mine','admin']).default('all'),archive_id:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}),outputSchema:z.object({tasks:z.array(z.record(z.string(),z.unknown()))})},(input:any)=>reply(()=>service.list(input),r=>({count:(r.tasks as unknown[]).length})));
  server.registerTool('create_work_task',{description:'创建工作任务。系统自动带出和推送只对明确类型生效；custom 任务保留在全组看板，不进入倾向推送。创建不直接建立负责人。',annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:workTaskCreateInput,outputSchema:z.object({id:z.string(),kind:z.string(),status:z.string(),version:z.number(),changed:z.boolean()}).passthrough()},(input:any)=>reply(()=>service.create(input),r=>({id:r.id,version:r.version,changed:r.changed})));
  server.registerTool('claim_work_task',{description:'主动领取开启且无负责人的工作任务。推荐只影响推送，不限制从全组看板领取。',annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:workTaskClaimInput,outputSchema:z.object({id:z.string(),owner_id:z.string(),version:z.number(),changed:z.boolean()}).passthrough()},(input:any)=>reply(()=>service.claim(input),r=>({id:r.id,version:r.version,changed:r.changed})));
  server.registerTool('complete_work_task',{description:'由当前负责人提交工作结果并关闭任务。结果可以如实说明未联系到对象，不要求系统判断沟通是否成功；不能替别人完成任务。',annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:workTaskCompleteInput,outputSchema:z.object({id:z.string(),status:z.string(),version:z.number(),changed:z.boolean()}).passthrough()},(input:any)=>reply(()=>service.complete(input),r=>({id:r.id,version:r.version,changed:r.changed})));
  server.registerTool('release_work_task',{description:'当前负责人可以主动交还任务，解除负责人并回到待领取；必须给出新的接取期限，历史会保留。',annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:workTaskReleaseInput,outputSchema:z.object({id:z.string(),status:z.string(),owner_id:z.null(),version:z.number(),changed:z.boolean()}).passthrough()},(input:any)=>reply(()=>service.release(input),r=>({id:r.id,version:r.version,changed:r.changed})));
  server.registerTool('assign_work_task',{description:'仅管理员明确指派开启中的工作任务。需要指定活跃成员和简短理由；这会停止普通倾向推送，但记录为管理员指派，不伪装成主动领取。',annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:workTaskAssignInput,outputSchema:z.object({id:z.string(),owner_id:z.string(),version:z.number(),changed:z.boolean(),assigned:z.boolean()}).passthrough()},(input:any)=>reply(()=>service.assign(input),r=>({id:r.id,version:r.version,changed:r.changed,assigned:r.assigned})));
}
