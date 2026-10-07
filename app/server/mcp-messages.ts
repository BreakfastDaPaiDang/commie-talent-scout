import {z} from 'zod';
import {Messages,messageListInput,messageReadInput} from './messages.ts';
import {registerJournalFields} from './mcp-journal.ts';
import type {McpReply} from './mcp-members.ts';
import type {Actor,Env} from './types.ts';

export const messageToolNames=['get_message_summary','list_messages','mark_messages_read'];
registerJournalFields('get_message_summary',[]);
registerJournalFields('list_messages',['unread','limit']);
registerJournalFields('mark_messages_read',['ids']);
export const messageGuides=['消息是当前成员的独立提醒流；读取消息不会确认档案未读更新，也不会改变任务期限、领取或完成状态。','任务负责人只会收到当前期限版本的截止提醒；延长期限、交还或关闭任务后，旧提醒自动失效。','消息正文只包含任务提醒和结果，不扩展档案正文权限；归档被删除或成员被冻结后不可继续读取。'];
export function registerMessageTools(server:any,env:Env,actor:Actor,reply:McpReply){
 const service=new Messages(env,actor),read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},record=z.record(z.string(),z.unknown());
 server.registerTool('get_message_summary',{description:'返回当前成员仍可读取的未读消息数量，不改变消息或任务状态。',annotations:read,inputSchema:{},outputSchema:z.object({total:z.number()})},()=>reply(()=>service.summary(),r=>({total:r.total})));
 server.registerTool('list_messages',{description:'分页读取当前成员可见的任务提醒和截止结果；不会确认档案阅读。',annotations:read,inputSchema:messageListInput,outputSchema:z.object({messages:z.array(record)})},(input:any)=>reply(()=>service.list(input),r=>({count:(r.messages as unknown[]).length})));
 server.registerTool('mark_messages_read',{description:'仅将当前成员可见的消息标为已读。不会延长、领取、完成或修改任务。',annotations:{...read,readOnlyHint:false},inputSchema:messageReadInput,outputSchema:z.object({ids:z.array(z.string()),marked:z.number()})},(input:any)=>reply(()=>service.markRead(input),r=>({marked:r.marked})));
}
