import {z} from 'zod';
import {Notifications,notificationListInput,notificationConfirmInput} from './notifications.ts';
import {Messages,messageListInput,messageReadInput} from './messages.ts';
import {registerJournalFields} from './mcp-journal.ts';
import type {McpReply} from './mcp-members.ts';
import type {Actor,Env} from './types.ts';

export const messageToolNames=['get_message_summary','list_messages','mark_messages_read','get_notification_summary','list_notifications','confirm_notifications'];
registerJournalFields('get_notification_summary',[]);
registerJournalFields('list_notifications',['source','unread','limit']);
registerJournalFields('confirm_notifications',['mode']);
registerJournalFields('get_message_summary',[]);
registerJournalFields('list_messages',['unread','limit']);
registerJournalFields('mark_messages_read',['ids']);
export const messageGuides=['优先使用 get_notification_summary/list_notifications：任务提醒与档案更新共用消息身份、来源、接收人、时间线与已读查询；source 可筛选 task/archive/all。分页必须一起传回 snapshot 和 next_cursor（作为 cursor）。','confirm_notifications 按 mode 确认：message 仅接受 task: 消息 ID；event 使用已收到完整内容的 reading.ticket；archive 仅供网页打开档案时使用其快照票据。列表摘要不是正文，不得仅凭 archive: ID 标记已读。旧工具仍兼容。','消息是当前成员的独立提醒流；读取消息不会确认档案未读更新，也不会改变任务期限、领取或完成状态。','任务负责人只会收到当前期限版本的截止提醒；延长期限、交还或关闭任务后，旧提醒自动失效。','消息正文只包含任务提醒和结果，不扩展档案正文权限；归档被删除或成员被冻结后不可继续读取。'];
export function registerMessageTools(server:any,env:Env,actor:Actor,reply:McpReply){
 const service=new Messages(env,actor),read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},record=z.record(z.string(),z.unknown());
 const notifications=new Notifications(env,actor);
 server.registerTool('get_notification_summary',{description:'统一返回当前成员任务提醒、档案更新与总未读数量。',annotations:read,inputSchema:{},outputSchema:z.object({total:z.number(),reading:z.number(),messages:z.number()})},()=>reply(()=>notifications.summary(),r=>({total:r.total})));
 server.registerTool('list_notifications',{description:'统一消息时间线；可按来源和未读筛选，按 snapshot/cursor 分页。只返回元数据，不确认阅读。',annotations:read,inputSchema:notificationListInput,outputSchema:z.object({notifications:z.array(record),snapshot:z.string(),next_cursor:z.string().nullable()})},(a:any)=>reply(()=>notifications.list(a),r=>({count:(r.notifications as unknown[]).length})));
 server.registerTool('confirm_notifications',{description:'按消息来源确认已读；档案内容必须先实际读取并取得票据。不会领取、完成或延期任务。',annotations:{...read,readOnlyHint:false},inputSchema:notificationConfirmInput,outputSchema:record},(a:any)=>reply(()=>notifications.confirm(a),()=>({})));
 server.registerTool('get_message_summary',{description:'返回当前成员仍可读取的未读消息数量，不改变消息或任务状态。',annotations:read,inputSchema:{},outputSchema:z.object({total:z.number()})},()=>reply(()=>service.summary(),r=>({total:r.total})));
 server.registerTool('list_messages',{description:'分页读取当前成员可见的任务提醒和截止结果；不会确认档案阅读。',annotations:read,inputSchema:messageListInput,outputSchema:z.object({messages:z.array(record)})},(input:any)=>reply(()=>service.list(input),r=>({count:(r.messages as unknown[]).length})));
 server.registerTool('mark_messages_read',{description:'仅将当前成员可见的消息标为已读。不会延长、领取、完成或修改任务。',annotations:{...read,readOnlyHint:false},inputSchema:messageReadInput,outputSchema:z.object({ids:z.array(z.string()),marked:z.number()})},(input:any)=>reply(()=>service.markRead(input),r=>({marked:r.marked})));
}
