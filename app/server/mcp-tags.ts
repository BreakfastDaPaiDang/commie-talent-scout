import {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {Tags,tagBatchInput,tagCreateInput,categoryCreateInput,tagListInput} from './tags.ts';
import {registerJournalFields} from './mcp-journal.ts';
import {taskContextInput,recordTaskContext,taskIdSchema,businessInput} from './mcp-tasks.ts';
import type {McpReply} from './mcp-members.ts';
import type {Actor,Env} from './types.ts';
export const tagToolNames=['list_tag_categories','list_tags','create_tag_category','create_tag','get_archive_tags','update_archive_tags','record_task_context'];
for(const [tool,fields] of Object.entries({list_tag_categories:['type'],list_tags:['type','query','category_id','include_disabled','before','limit'],create_tag_category:['type','name','description','color','request_id'],create_tag:['category_id','name','description','request_id'],get_archive_tags:['archive_id'],update_archive_tags:['archive_id','expected_version','changes','focus','request_id']}))registerJournalFields(tool,fields);
export const tagGuides=[
 '人物与组织独立词库。先读 get_archive_tags 及 list_tags 的通用描述，优先复用；确无适用词义时可在已授权整理范围内 create_tag_category/create_tag。词条创建与档案绑定是不同动作，重名返回已有 ID，不覆盖描述。',
 '公共描述仅解释通用词义，不写某份档案的事实。标签名本身不含冒号，类别单独指定。新建后仍需 update_archive_tags 绑定。标签与状态、负责人不同，不能相互替代。',
 '从观察推导时先 get_observation/list_observations/list_observation_versions 实际读取所引用版本，提供 kind=observation、observation_id、content_version、note；系统检查当前凭证已读和来源可见。本人自述/成员指令若出自观察，同样保留引用，不能换 kind 绕过权限。',
 '用户本次明确提供的独立材料可以 kind=self_statement 或 member_instruction，并在 note 写明参与者、日期/范围与具体来源；没有记录引用表示独立材料，不能将已读观察伪装成独立材料。网页手工绑定可以没有附加依据，Agent 不可无依据绑定。',
 'update_archive_tags 用 changes 批量 add/remove/evidence，一批一个事件；重复 add 保留旧依据，无变化不产生动态。改依据必须明确 action=evidence。focus 最多三个，只按用户明确选择设置，省略则保持；不能按猜测给人排序。',
 '先核对旧依据，材料未提及不等于旧特征失效；资源交接不表示技能丧失。只有明确变化才移除；冲突不能仅凭新旧顺序覆盖。来源不可读的绑定、依据、重点与事件不会显示，也不能借公共描述重建副本。',
 '关闭时冻结定义与依据，所有成员均不能改绑定。显式重开后采用当前定义，结果列出差异；停用/合并项保留旧绑定，不自动迁移。当前公共定义修改/合并将在后续切片开放，能力以工具目录为准。',
];
export const compressionGuides=[
 '成员已要求把聊天/材料整理进档案时，主动完成必要的观察、标签复用/新建/增减和明确资料补充，不要求逐个点名或再审批每个标签。只给材料且意图不清时提出具体整理方案；只查、分析或写草稿不自动入库。',
 '先 whoami，再查询同类型候选档案、已有观察和标签定义/依据；名称不唯一，结合已有联系方式、组织或事件确定稳定 ID。有影响结果的同名歧义只问一个具体问题，不先猜一个对象写入。',
 '区别聊天发言者、本人自述、成员转述和判断；保留事件、背景、发生时间与条件。不从计划推出能力、不从用词/议题/交往推断身份、健康诊断或可靠性。观察可长可短，保留关键事实而非逐句复述。',
 '观察正文应把材料整理得更易读、更简练：合并重复表述，只保存该对象的新事实、必要背景、时间与来源。不要把工具步骤、打标决策、推断禁令或权限说明写进观察；来源已标自述时无需逐段重复未核验。其他发言者的无关能力通常不入这份观察；确有混淆风险时一句澄清即可。无强制标题、段数或字数，避免比原聊天更冗长的流程解说。',
 '先比较已有材料。有新事实才补观察，重复材料且无纠正不制造记录或标签；新材料未提旧项就保留。查旧依据再处理冲突；阶段性可用时间明确日期/时区，资源交接不表示技能消失。',
 '整理入口 record_task_context 一次提供 purpose，可选原话 original_request、Agent 摘要 agent_summary、材料种类和本次源材料/引用，返回服务生成 task_id，后续调用复用。原话未知就省略，不把摘要当原话；不要求传无关聊天或内部推理。不提供任务上下文仍可正常办理。',
 '常用顺序：确认对象 → 读取旧材料/词库 → 记录任务上下文（适用时）→ 发布必要观察 → 实际读取新记录 → 按依据批量维护标签。每次操作用独立 request_id；重试保留原 ID 和参数。多步不是一个事务，失败时保留已完成和剩余清单。',
 '完成后简短报告实际观察、标签复用/新建/移除、返回的 archive_url 对象链接和仍有歧义或失败部分；以真实返回为准。超时先 get_request_result 核对已知收据，不能换 ID 重复写入，不能为完成任务擅自重开或放宽权限。',
];
export function registerTagTools(server:McpServer,env:Env,actor:Actor,reply:McpReply){
 const service=new Tags(env,actor,'mcp'),read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},write={...read,readOnlyHint:false},output=z.record(z.string(),z.unknown()),summary=(r:Record<string,unknown>)=>({id:r.id,archive_id:r.archive_id,task_id:r.task_id,version:r.version,changed:r.changed,added:r.added,removed:r.removed});
 server.registerTool('list_tag_categories',{description:'读取人物/组织词库的类别、描述、颜色、版本与停用状态。类别名和标签名分开，优先复用。',annotations:read,inputSchema:{type:z.enum(['person','org']),task_id:taskIdSchema},outputSchema:output},a=>reply(()=>service.categories(a.type)));
 server.registerTool('list_tags',{description:'按人物/组织、类别及名称/描述搜索词库，返回通用描述、版本和当前成员可见绑定数。先读描述再复用，next_cursor 非空须按需翻页。',annotations:read,inputSchema:tagListInput.extend({task_id:taskIdSchema}),outputSchema:output},a=>reply(()=>service.list(businessInput(a)),r=>({count:(r.tags as unknown[]).length})));
 server.registerTool('create_tag_category',{description:'在已授权整理范围内创建确有需要的类别。人物/组织独立，同库规范化重名返回已有 ID，不覆盖定义。',annotations:write,inputSchema:categoryCreateInput.extend({task_id:taskIdSchema}),outputSchema:output},a=>reply(()=>service.createCategory(businessInput(a)),summary));
 server.registerTool('create_tag',{description:'已有词库描述确无适用项时创建有通用描述的词条。category_id 与无冒号的名称分开提供；重名复用，不自动绑定。禁止把具体档案材料写入公共定义。',annotations:write,inputSchema:tagCreateInput.extend({task_id:taskIdSchema}),outputSchema:output},a=>reply(()=>service.create(businessInput(a)),summary));
 server.registerTool('get_archive_tags',{description:'读取档案当前可见标签、词义、来源/版本、重点、确认时间和档案版本。绑定维护前必读，隐藏来源不构成无标签事实。',annotations:read,inputSchema:{archive_id:z.uuid(),task_id:taskIdSchema},outputSchema:output},a=>reply(()=>service.bindings(a.archive_id),r=>({archive_id:r.archive_id,version:r.version})));
 server.registerTool('update_archive_tags',{description:'已授权整理时按明确证据批量增减或更新依据，一批一个事件。先读旧依据和实际记录版本；Agent 每个新增/依据更新须有来源，重复添加不覆盖。新材料未提及不得据此移除。重点最多三项且不猜测。',annotations:write,inputSchema:tagBatchInput.safeExtend({task_id:taskIdSchema}),outputSchema:output},a=>reply(()=>service.batch(businessInput(a)),summary));
 server.registerTool('record_task_context',{description:'材料整理时一次轻量记录任务目的、可选用户原话/Agent 摘要、源材料及引用，返回 task_id 供后续调用关联。缺原话标未知，不采集无关会话；不强制开始/结束才能办理业务。提交内容私有留存 30 天用于排错和改进。',annotations:write,inputSchema:taskContextInput,outputSchema:output},a=>reply(()=>recordTaskContext(env,actor,a),summary));
}
