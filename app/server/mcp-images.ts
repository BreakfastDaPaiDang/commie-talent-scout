import {McpServer} from '@modelcontextprotocol/server';
import {Buffer} from 'node:buffer';
import {z} from 'zod';
import {Images,prepareImageInput} from './images.ts';
import {Avatars,avatarInput} from './avatars.ts';
import {Members,memberProfileInput} from './members.ts';
import {registerJournalFields} from './mcp-journal.ts';
import {Failure,type Actor,type Env} from './types.ts';
import type {McpReply} from './mcp-members.ts';

export const imageToolNames=['prepare_image_upload','get_upload_status','get_image','set_avatar','update_own_profile'];
for(const [name,keys] of Object.entries({prepare_image_upload:['purpose','archive_id','member_id','mime_type','byte_size','sha256'],get_upload_status:['upload_id'],get_image:['attachment_id'],set_avatar:['subject_type','id','expected_version','attachment_id','request_id'],update_own_profile:['id','expected_version','name','qq','request_id']}))registerJournalFields(name,keys);
export const imageGuides=[
 '观察支持文字、图片或两者；一条最多 10 张 PNG/JPEG/WebP 静态图片，每张至多 10 MiB、4000 万像素。保留原图，不接受 SVG/GIF 或动态图。',
 '先核对目标档案。用户已授权本地文件上传时，读取文件计算真实字节数和小写 SHA-256，prepare_image_upload 选择 observation 并传 archive_id。按返回 URL、PUT 方法和 headers 发送原始文件字节，勿发送 multipart 或 JSON。不要回显上传票据或写入普通日志。客户端需具有读取该文件和 HTTP 上传的权限，不能声称仅调用 prepare 就上传完成。',
 '上传后 get_upload_status 核实 ready，再将 attachment.id 作为 create_observation/update_observation 的 attachment_ids。准备或上传不发布记录，也不等于用户确认最终图文；先展示正文草稿和拟配图片，确认后才发布。上传结果不明先查状态；ready 不再 PUT，pending 且未过期可用原票据重试，expired 重新准备。准备响应丢失可重新准备，不会重复发布。发布结果不明仍使用原 request_id 查询。',
 '编辑时省略 attachment_ids 会保留现有图片，明确传 [] 才移除当前版本图片。每次编辑生成完整内容版本，旧版本原图保留。图片只可绑定其上传目标档案的一条观察，不可串用其他档案/记录。',
 'get_observation 和版本历史只返回图片元数据；需要辨识图片内容时调用 get_image，返回标准 MCP image 内容。仅凭文件名或元数据不能声称看过图片。删除记录的图片沿用该记录当前权限；未绑定图片仅上传本人可读。',
 '头像先用 prepare_image_upload 的 archive_avatar/archive_id 或 member_avatar/member_id，上传 ready 后 set_avatar 并提供目标当前版本。attachment_id:null 移除上传头像，保留 QQ，恢复 QQ 或默认头像。档案关闭时不能修改头像。本人可 update_own_profile 更新显示名称和 QQ，其他猎头账号资料维护需管理员权限。',
];
let reading=false;
export function registerImageTools(server:McpServer,env:Env,actor:Actor,reply:McpReply){
 const images=new Images(env,actor,'mcp'),read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},write={...read,readOnlyHint:false};
 server.registerTool('prepare_image_upload',{description:'为用户授权的本地静态图片准备 10 分钟上传票据；不上传、不发布。先算实际 MIME、字节数及 SHA-256，再由客户端按返回 URL/headers PUT 原始字节。票据保密，原始凭证不用于 PUT。详见 images 指南。',annotations:{...write,idempotentHint:false},inputSchema:prepareImageInput},input=>reply(()=>images.prepare(input),r=>({upload_id:r.upload_id,purpose:input.purpose,byte_size:input.byte_size,expires_at:r.expires_at})));
 server.registerTool('get_upload_status',{description:'仅查询本人上传状态。ready 时返回可用于观察或头像的 attachment；pending/expired 未完成，网络结果不明先查此工具。',annotations:read,inputSchema:{upload_id:z.uuid()}},input=>reply(()=>images.status(input.upload_id),r=>({upload_id:r.upload_id,state:r.state})));
 server.registerTool('get_image',{description:'读取当前有权查看的附件，返回标准 MCP image 内容供视觉理解。先从观察、版本历史或上传状态取得 attachment_id；元数据不等于已经看到图片。',annotations:read,inputSchema:{attachment_id:z.uuid()}},input=>reply(async()=>({attachment_id:input.attachment_id}),r=>({attachment_id:r.attachment_id,image_returned:true}),async()=>{
  if(reading)throw new Failure(429,'IMAGE_READ_BUSY','图片读取繁忙，请稍后重试');reading=true;
  try{const response=await images.read(input.attachment_id),bytes=await response.arrayBuffer();return [{type:'image',data:Buffer.from(bytes).toString('base64'),mimeType:response.headers.get('Content-Type')!}];}finally{reading=false;}
 }));
 server.registerTool('set_avatar',{description:'设置或移除档案/猎头头像；先上传对应目的和对象的图片并确认 ready，再提供当前资料版本。null 移除上传头像而不清除 QQ。关闭档案禁止修改，普通成员只能改本人账号头像。',annotations:write,inputSchema:avatarInput},input=>reply(()=>new Avatars(env,actor,'mcp').set(input),r=>({id:r.id,version:r.version,changed:r.changed})));
 server.registerTool('update_own_profile',{description:'按用户要求更新当前登录猎头本人的显示名称和 QQ；id 和 expected_version 来自 whoami，传完整 name/qq。不改变登录名、角色和密码。',annotations:write,inputSchema:memberProfileInput},input=>reply(()=>new Members(env,actor,'mcp').updateOwnProfile(input),r=>({id:r.id,version:r.version,changed:r.changed})));
}
