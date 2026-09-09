import {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {Reading,confirmReadingInput,unreadListInput} from './reading.ts';
import {Observations} from './observations.ts';
import {registerJournalFields} from './mcp-journal.ts';
import type {McpReply} from './mcp-members.ts';
import type {Actor,Env} from './types.ts';
export const readingToolNames=['get_unread_summary','list_unread_events','get_archive_event','confirm_reading'];
for(const [name,fields] of Object.entries({get_unread_summary:[],list_unread_events:['archive_id','exclude_archive_id','exclude_event_id','before','snapshot','limit'],get_archive_event:['id'],confirm_reading:[]}))registerJournalFields(name,fields);
export const readingGuides=[
 '阅读进度属于当前成员，网页与 MCP 共用。排除本人动作和账号创建前事件；编辑产生新的未读事件，不影响档案活动排序。',
 '网页成功打开档案时一次确认当时已有可见未读；MCP 仍按所需完整内容逐事件确认。get_archive 或列表元数据不触发网页的整档确认。',
 '列表摘要、搜索命中与 get_unread_summary/list_unread_events 不等于读过正文。仅在实际收到本次任务所需的完整内容后，用返回 reading.ticket 调用 confirm_reading；不得猜测票据、预先确认或为了清空未读扩大读取范围。',
 'get_observation/list_observations 返回当前正文，list_archive_timeline/get_archive_event 返回事件内容及可见正文。每张票据绑定当前连接、事件和观察状态，重复确认安全；unconfirmed 表示未确认，重新读取确实需要的内容后再确认。图片附件的实际读取按 images 指南。',
 'list_unread_events 同时覆盖人物和组织，保存 snapshot 与 next_cursor 分页；下一条可先按 archive_id 与 exclude_event_id 查询当前档案剩余未读，保留本次已读条目位置；新更新留待下一次队列。get_archive_event 按稳定事件 ID 直达，不受原搜索筛选限制；已删除事件只给出可见上下文，关闭档案仍可阅读。',
 'list_archives 可按正文 query、scope(all/mine/unread)、status、member_id、closed(all/open/closed) 组合查询。mine 表示关联我：当前状态关联成员包含调用者即命中，不限工作状态或开启状态；旧状态历史关联不计入，仍遵循其他筛选和删除权限。counts.mine 使用同一口径。search_match 提供当前未删除观察的命中摘要和 ID，须 get_observation 读取全文。',
];
export function registerReadingTools(server:McpServer,env:Env,actor:Actor,reply:McpReply){
 const service=new Reading(env,actor),read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},record=z.record(z.string(),z.unknown());
 server.registerTool('get_unread_summary',{description:'当前成员未读更新数量，人物与组织分开；只返回计数，不推进阅读进度。阅读流程见 reading 指南。',annotations:read,inputSchema:{},outputSchema:z.object({groups:z.array(record),total:z.number()})},()=>reply(()=>service.summary(),r=>({total:r.total})));
 server.registerTool('list_unread_events',{description:'分页列出本次跨人物/组织的未读队列，沿用 snapshot 和 next_cursor；仅含导航元数据，不确认阅读。按用户任务范围读取所需事件。',annotations:read,inputSchema:unreadListInput,outputSchema:z.object({events:z.array(record),snapshot:z.number(),next_cursor:z.string().nullable()})},a=>reply(()=>service.list(a),r=>({count:(r.events as unknown[]).length})));
 server.registerTool('get_archive_event',{description:'按事件 ID 读取可见的具体事件及当前观察正文，直达搜索或未读目标；删除或关闭目标保留可见上下文。实际收到内容后按 reading.ticket 确认阅读。',annotations:read,inputSchema:{id:z.uuid()},outputSchema:z.object({event:record})},a=>reply(()=>new Observations(env,actor,'mcp').event(a.id),r=>({id:(r.event as Record<string,unknown>).id})));
 server.registerTool('confirm_reading',{description:'仅在实际收到前次工具返回的完整内容之后，确认其中 reading.ticket 对应事件。按事件幂等更新本人阅读进度，不改业务内容或活动排序；摘要、未返回和失败内容不能确认。',annotations:{...read,readOnlyHint:false},inputSchema:confirmReadingInput,outputSchema:z.object({confirmed:z.array(record),unconfirmed:z.array(z.string())})},a=>reply(()=>service.confirm(a),r=>({confirmed:(r.confirmed as unknown[]).length,unconfirmed:(r.unconfirmed as unknown[]).length})));
}
