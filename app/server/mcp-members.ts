import {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {Members,memberListInput,memberCreateInput,memberFrozenInput,memberRoleInput,memberResetInput,memberProfileInput} from './members.ts';
import {registerJournalFields} from './mcp-journal.ts';
import {getRequestResult,requestId} from './commands.ts';
import {type Actor,type Env} from './types.ts';

export type McpContent={type:'text';text:string}|{type:'image';data:string;mimeType:string};
export type McpReply=(action:()=>Promise<Record<string,unknown>>,summary?:(result:Record<string,unknown>)=>Record<string,unknown>,content?:(result:Record<string,unknown>)=>Promise<McpContent[]>)=>Promise<{content:McpContent[];structuredContent:Record<string,unknown>;isError?:boolean}>;
export const memberToolNames=['list_members','get_member','create_member','reset_member_password','set_member_frozen','set_member_role','update_member_profile','get_member_history','get_request_result'];
const fields:Record<string,string[]>={
  list_members:['state','before','limit'],get_member:['id'],create_member:['username','name','role','qq','request_id'],
  reset_member_password:['id','expected_version','request_id'],set_member_frozen:['id','expected_version','frozen','request_id'],
  set_member_role:['id','expected_version','role','request_id'],update_member_profile:['id','expected_version','name','qq','request_id'],
  get_member_history:['id'],get_request_result:['request_id'],
};
for(const [name,keys] of Object.entries(fields))registerJournalFields(name,keys);
export const memberGuides=[
  '账号管理只供管理员使用。先 list_members 核对稳定 ID、当前版本与角色；默认只列未冻结账号，查找已冻结账号使用 state:frozen，完整管理核对使用 state:all；人物档案不是登录成员账号。',
  '创建或重置账号时，由客户端产生至少 10 位的临时密码，先保存在用户授权的私有位置并私下交付。服务只保存带盐 scrypt 哈希，不返回密码，不在最终聊天或普通日志回显密码。',
  '重置密码会立即使旧网页会话和 MCP 凭证失效；成员重新登录后必须更换临时密码。重置自己同样会断开本连接，操作前确保新临时密码已妥善保存。',
  '冻结立即阻止登录和已有凭证，解冻也不会恢复旧凭证。冻结不删除成员或更改历史作者、负责人归属。',
  '角色调整立即影响后续请求；至少保留一名未冻结管理员。不要为完成其他业务擅自授予管理员、解冻或改变成员身份。',
  '每次业务操作使用新的 request_id；网络结果不明时 get_request_result 查询或原参数原 ID 重试。修改参数或临时密码必须作为明确的新操作，不能复用旧 ID。',
];
export function registerMemberTools(server:McpServer,env:Env,actor:Actor,reply:McpReply){
  const service=new Members(env,actor,'mcp');
  const read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  const write={readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  const destructive={...write,destructiveHint:true};
  const version=z.object({id:z.string(),version:z.number(),changed:z.boolean()}).passthrough();
  const summary=(r:Record<string,unknown>)=>({id:r.id,version:r.version,changed:r.changed});
  server.registerTool('list_members',{description:'管理员查看猎头账号列表与当前版本，默认仅未冻结账号；state:frozen 查看已冻结，state:all 包含全部。供创建前查重、冻结、重置和角色调整使用。普通成员不能调用；支持分页，不返回密码或哈希。',annotations:read,inputSchema:memberListInput,outputSchema:z.object({members:z.array(z.object({id:z.string(),username:z.string(),name:z.string(),version:z.number()}).passthrough()),next_cursor:z.string().nullable()})},input=>reply(()=>service.list(input),r=>({count:(r.members as unknown[]).length,next_cursor:r.next_cursor})));
  server.registerTool('get_member',{description:'管理员读取指定猎头账号的当前资料、角色、冻结状态与版本，用于冲突后核对。返回成员稳定 ID，不返回密码、哈希或个人连接秘密。',annotations:read,inputSchema:{id:z.uuid()},outputSchema:z.object({member:z.object({id:z.string(),username:z.string(),name:z.string(),version:z.number(),frozen:z.boolean()}).passthrough()})},input=>reply(()=>service.detail(input.id),r=>({id:(r.member as Record<string,unknown>).id})));
  server.registerTool('create_member',{description:'仅管理员在用户明确要求建号时创建猎头账号。temporary_password 由客户端生成并私下交付，服务不回显；首登必须改密。重复请求使用原 ID 和相同参数，不把人物档案误建成账号。',annotations:write,inputSchema:memberCreateInput,outputSchema:version},input=>reply(()=>service.create(input),summary));
  server.registerTool('reset_member_password',{description:'仅管理员在用户明确要求时重置指定成员密码，使该成员所有旧网页会话与 MCP 凭证立即失效。客户端先私下保存 temporary_password，不回显；目标首登须改密。先读取成员版本，重置自己会断开本连接。',annotations:destructive,inputSchema:memberResetInput,outputSchema:version},input=>reply(()=>service.resetPassword(input),summary));
  server.registerTool('set_member_frozen',{description:'仅管理员按明确要求冻结或解冻猎头账号。冻结立即阻止登录并使旧凭证失效，解冻不恢复旧凭证；不删除历史作者或负责人。先核对成员版本，系统拒绝冻结最后一名有效管理员。',annotations:destructive,inputSchema:memberFrozenInput,outputSchema:version},input=>reply(()=>service.setFrozen(input),summary));
  server.registerTool('set_member_role',{description:'仅管理员按明确授权调整指定账号的管理员/普通成员角色，后续请求立即使用新权限。不得为绕过其他操作限制而提权；先读取当前版本，不能降权最后一名有效管理员。',annotations:destructive,inputSchema:memberRoleInput,outputSchema:version},input=>reply(()=>service.setRole(input),summary));
  server.registerTool('update_member_profile',{description:'管理员维护猎头账号的显示名称和 QQ；不更改登录账号、角色、密码或人物档案。先 list_members 取得版本，提供完整目标字段；无变化不生成版本与审计事件。',annotations:write,inputSchema:memberProfileInput,outputSchema:version},input=>reply(()=>service.updateProfile(input),summary));
  server.registerTool('get_member_history',{description:'管理员读取指定猎头账号的管理历史，核对操作者、时间与入口。包含创建、角色、冻结、资料及重置事件；不返回密码或哈希，最多返回最近 100 项并声明是否完整。',annotations:read,inputSchema:{id:z.uuid()},outputSchema:z.object({events:z.array(z.record(z.string(),z.unknown())),complete:z.boolean()})},input=>reply(()=>service.history(input.id),r=>({count:(r.events as unknown[]).length,complete:r.complete})));
  server.registerTool('get_request_result',{description:'写入网络结果不明时，查询当前成员原 request_id 的已提交结果。completed 表示已提交；unknown 不证明仍在途的操作未发生，保留原 ID 与参数。管理员动作的结果仍要求当前管理员权限。',annotations:read,inputSchema:{request_id:requestId},outputSchema:z.object({status:z.enum(['completed','unknown']),result:z.record(z.string(),z.unknown()).nullable(),message:z.string().optional()})},input=>reply(()=>getRequestResult(env,actor,input.request_id),r=>({status:r.status})));
}
