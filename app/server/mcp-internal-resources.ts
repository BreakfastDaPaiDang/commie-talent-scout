import type {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {InternalResources,internalResourceInput,internalResourceListInput} from './internal-resources.ts';
import {registerJournalFields} from './mcp-journal.ts';
import type {McpReply} from './mcp-members.ts';
import type {Actor,Env} from './types.ts';
export const internalResourceToolNames=['list_internal_resources','get_internal_resource','save_internal_resource','list_internal_resource_history'];
export const internalResourceGuides=[
 '社内承接资源指社内实际拥有、用于接收/安排/支持新人的群聊、工作组、项目和其他条件。外部接触群、外部组织及用户举例不能自动视为社内资源，也不自动把旧 resources 条目转换为社内资源。',
 '先 list_internal_resources 搜索复用真实资源，分页到 next_offset=null 才读完。未登记时不代表数量为零或没有实际资源，只表示尚未登记。get_internal_resource 读取版本、适用阶段、负责成员、开放状态、容量及去重的实际/计划关联人数；capacity=null 表示未知，0表示零名额。',
 'save_internal_resource 只按用户明确提供的事实登记或维护；id=null/expected_version=0创建，已有资源先读当前版本。不默认指派调用者。status=paused表示暂停新增承接，archived表示停用，均保留历史和既有使用记录。名额是登记上限，实际记录超额时如实保留，不伪造剩余名额。',
 '档案资源使用条目必须以 internal_resource_id 关联已登记社内资源；name/type由该资源确定，note说明个人落实情况，usage=available/planned/active 分别是可用/计划/实际使用。计划不表示到位，登记实际使用也不改变审核或入社身份。旧的未确认关联只允许原样保留或移除，不会进入社内资源统计。',
 '写入使用稳定 request_id 和当前 expected_version；失败结果不明复用原参数及ID或 get_request_result 核实。资源改名在所有关联处显示同一名称，不能按同名自动合并。',
];
export function registerInternalResourceTools(server:McpServer,env:Env,actor:Actor,reply:McpReply){
 const s=new InternalResources(env,actor,'mcp'),read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
 for(const [name,keys] of Object.entries({list_internal_resources:['query','state','offset','limit'],get_internal_resource:['id'],save_internal_resource:Object.keys(internalResourceInput.shape),list_internal_resource_history:['id','offset']}))registerJournalFields(name,keys);
 server.registerTool('list_internal_resources',{description:'分页查询社内实际拥有的承接资源。',annotations:read,inputSchema:internalResourceListInput},a=>reply(()=>s.list(a)));
 server.registerTool('get_internal_resource',{description:'读取社内资源、版本、名额及去重使用人数。',annotations:read,inputSchema:{id:z.uuid()}},a=>reply(async()=>({resource:await s.get(a.id)})));
 server.registerTool('save_internal_resource',{description:'明确登记或维护真实社内承接资源，不从示例或外部联系推断。',annotations:{...read,readOnlyHint:false},inputSchema:internalResourceInput},a=>reply(()=>s.save(a)));
 server.registerTool('list_internal_resource_history',{description:'分页查看社内资源维护历史。',annotations:read,inputSchema:{id:z.uuid(),offset:z.number().int().min(0).default(0)}},a=>reply(()=>s.history(a)));
}
