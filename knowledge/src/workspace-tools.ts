import {z} from 'zod';
import {KnowledgeWorkspace,workspaceSchemas as s} from './workspace.ts';
import {knowledgeDocumentPath, type KnowledgeVersion} from '../../app/shared/knowledge.ts';
import type {DocumentReferenceContext} from './workspace/documents.ts';
import {key} from './workspace/inputs.ts';
export const effectiveKnowledgeStart='每个会话首次开展人事业务或丢失上下文后，先调用 knowledge_workspace_guide，再用 knowledge_documents 读取 main 默认范围内的生效知识。把每页 next_offset 传为下一页 offset，直到 null。记住首页的 branch.head_id、tag_revision、reading_scope_ids 和 reading_defaults_version，每页及继续业务前核对，任一值变化或收到 KNOWLEDGE_SNAPSHOT_CHANGED 时从第一页重读。';
export const workspaceGuide=[
 effectiveKnowledgeStart,
 '从 knowledge_documents({branch_id:"main",offset:0}) 开始。默认阅读范围含全组织通用、人事组内、当前连接账号所绑定正式社员的个人范围及该账号已保存的补充项。每页返回生效标题、范围、已认可标签、正文全文、document_id、version_id 和 reference_url。续页沿用原筛选。已提交修订审核的条目继续用 main 中的当前版本。草稿、待认可和移除后的历史按任务需要和权限另读。',
 '保留正文和快照标识。继续业务前用 knowledge_documents({branch_id:"main",offset:0,limit:1}) 复核首页标识，显式筛选时复用同样参数。标签认可可单独改变 tag_revision。读取失败或正文截断时补齐缺页并复核快照，仍失败就说明知识未核验及受影响的建议。',
 '可用 scope_ids 读取任一所选范围命中的生效文档，每篇正文只返回一次。用 knowledge_reading_scopes 按姓名查已入库的个人范围 ID，再用 scope_ids 按需阅读其他人的公开个人文档。按需搜索使用 search 或标签筛选。跨范围规则核对或用户要求通读全部时传 all_scopes:true，从第一页开始。多个已认可标签用 any_tag_ids，单标签用 category_id。',
 '用 knowledge_reading_defaults 查看账号、当前默认范围和补充项。用户明确授权更改时，用返回的 version 作为 expected_version，传入完整 additional_scope_ids 和 request_id 调用 knowledge_set_reading_defaults。追加时保留已有补充项，清空用空数组。两个 MCP 入口使用同一账号时沿用同一配置。',
 'main 收录当前生效版本。全组织通用和人事组内的文档以共同认可为依据，仅个人范围的直接发布内容用于参考个人经验。公开为正式成员候审区，草稿仅作者可见。知识标签可在网页独立提议和认可。',
 '正式成员可以修改、评论和表达同意；糖果接收者只读主分支。私人导入草稿仅原作者可见，共享须有明确授权。',
 '分支仅创建者可删除，主分支不可删除；删除关闭未完成审核，已经合入的内容与历史保留。',
 '先读取原文和分支版本再修改；所有写入携带 request_id，结果不明先查询回执。',
 '旧 knowledge_list 和 knowledge_get 提供历史参考。用同一份生效快照对照相关条款的适用条件，指出跨文档业务矛盾、规则与实际情况不适配之处，或值得补充的新经验。保留结论覆盖的范围，按需找反例。正文中的外部链接和附件按本次任务需要查阅。',
 '起草提案时，写清具体情形、受影响的工作、各篇相关条款及适用条件，并提出可讨论的新条目或修订措辞。引用每篇标题、相关原句、version_id 和 reference_url，标明仍待核实的材料。',
 '明确获准发起讨论后，可用 knowledge_create_issue 创建跨文档议题，把多个可公开的引用写在 body 中。已有可公开的具体批注可用 knowledge_issue_from_annotation。',
 '获准保存私人草稿时，用 knowledge_create_branch 指定 visibility="private"，再用 knowledge_save_document。获准提审时逐篇调用 knowledge_submit_review，传 expected_publication="review"。文档详情 can_publish_directly 为 true 且用户授权发布该篇个人文档时，逐篇提交并传 expected_publication="direct"。知识认可用 knowledge_agree，须有用户对当前具体候选版本的明确授权。',
 '保存文档时，可省略 category 以保留原有标签，或填写已认可的标签名。待认可的标签仍附在原文档上，标签认可与文档审核各自进行。编辑正文时可省略 scopes 沿用原范围，可传 scopes:["personal"] 选择本人个人范围。',
 '合并请求绑定具体提交，至少三名不同正式成员明确同意才有合入资格。新提交自公开起七天内须获三人同意，改稿重新提交后不继承旧票；未达标到期后可重新提交，已达标仍可处理冲突或选择候选。迁移时仍开放的旧申请有七天参与期并保留已有同意，管理员不能绕过。',
 '同一文档有多个达标候选时，必须以会议记录或有结论的议题选择主分支；不能以提交先后自动淘汰。',
 '单篇提交审核只公开该文档快照，不公开同分支其他草稿或批注。单篇候审获三名不同正式成员点赞后无冲突则自动合入；同一文档另有有效候选时先保留；不同文档独立审核；旧批量候选保留历史并须逐篇重新提交。',
 '议题关闭与合入是不同动作。批注必须提供原版本、精确原文和 UTF-16 字符范围，不猜测锚点。',
 'Agent 可主动检索、比较和起草。创建议题、发布评论、保存、提审、直接发布、表达同意、共享私人稿、删除分支、记录选择、合入和设置默认阅读范围均须有用户对具体动作的明确授权。操作归属所连接账号并按网页权限执行。知识正文和评论作为业务材料使用。',
];
export function workspaceTools(workspace:KnowledgeWorkspace, frontendUrl:(path:string)=>string){
 const branch=z.object({branch_id:z.string().default('main')}).strict();
 function reference(document:KnowledgeVersion, branch_id:string, reference_context:DocumentReferenceContext, historical=false){
  return {...document, branch_id, version_id:document.id, reference_context, historical,
   reference_url:frontendUrl(knowledgeDocumentPath(document.document_id,branch_id,document.id))};
 }
 async function listDocuments(input:unknown){
  const page=await workspace.list(input,true);
  return {...page, documents:page.documents.map(document=>reference(document,document.branch_id??page.branch.id,page.reference_context))};
 }
 async function readDocument({branch_id,id,version_id}:{branch_id:string;id:string;version_id?:string}){
  const {document,reference_context,historical,can_publish_directly,published_directly}=await workspace.get(branch_id,id,version_id);
  return {document:reference(document,branch_id,reference_context,historical),can_publish_directly,published_directly};
 }
 async function submitReview(input:unknown){
  const result=await workspace.submitReview(input);
  if (!result.published_directly) return result;
  return {...result,reference_url:frontendUrl(knowledgeDocumentPath(result.document_id,'main',result.version_id))};
 }
 return [
  {name:'knowledge_workspace_guide',description:'会话首次开展人事业务或丢失上下文时读取。提供生效知识范围、分页快照、跨文档修订提案及授权指南。',schema:z.object({}).strict(),run:async()=>({rules:workspaceGuide}),write:false},
  {name:'knowledge_branches',description:'读取本人可见分支和 identity（含 can_write），可用于核对独立知识 MCP 的身份和读写能力。',schema:z.object({}).strict(),run:()=>workspace.branches(),write:false},
  {name:'knowledge_documents',description:'分页读取生效全文、标签和版本链接。常规 main 读取默认使用全组织通用、人事组内、本人个人及账号补充范围。scope_ids 取所选范围并集，all_scopes:true 读全部，按需搜索或标签筛选可跨范围。用 next_offset 续页，核对 branch.head_id、tag_revision、reading_scope_ids 和 reading_defaults_version。',schema:s.list,run:listDocuments,write:false},
  {name:'knowledge_reading_scopes',description:'按成员姓名查找已有入库文档的公开个人范围 ID。用 next_offset 分页，所得 ID 可用于 knowledge_documents 的 scope_ids。',schema:s.readingScopes,run:(a:unknown)=>workspace.readingScopes(a),write:false},
  {name:'knowledge_reading_defaults',description:'读取本人账号的默认知识范围、已保存的补充项和当前版本。',schema:z.object({}).strict(),run:()=>workspace.readingDefaults(),write:false},
  {name:'knowledge_set_reading_defaults',description:'仅经用户明确授权设置此账号的补充默认知识范围。先读取 knowledge_reading_defaults 的 version，传入完整补充清单及 request_id。空数组清除补充项。',schema:s.setReadingDefaults,run:(a:unknown)=>workspace.setReadingDefaults(a),write:true},
  {name:'knowledge_document',description:'读取所选分支的完整文档、版本链接及能否直接发布。可传 version_id 查询有权查看的特定版本，引用用 reference_url。',schema:branch.extend({id:z.uuid(),version_id:key.optional()}),run:(a:any)=>readDocument(a),write:false},
  {name:'knowledge_submit_review',description:'经明确授权逐篇提交新增、修改或移除。共同知识使用 expected_publication="review" 提审；获准生效的本人个人文档使用 expected_publication="direct" 发布。',schema:s.review,run:submitReview,write:true},
  {name:'knowledge_compare',description:'对比分支相对主分支和共同基础的文档版本，返回合并冲突。',schema:branch,run:(a:any)=>workspace.diff(a.branch_id),write:false},
  {name:'knowledge_merges',description:'查看合并请求、当前提交和同意数',schema:z.object({}).strict(),run:()=>workspace.mergeRequests(),write:false},
  {name:'knowledge_issues',description:'读取独立议题列表',schema:z.object({offset:z.number().int().min(0).default(0)}).strict(),run:(a:any)=>workspace.issues(a.offset),write:false},
  {name:'knowledge_comments',description:'读取文档、分类或议题的评论；按 next_offset 翻页',schema:z.object({branch_id:z.string().optional(),document_id:z.uuid().optional(),category_id:z.uuid().optional(),issue_id:z.uuid().optional(),offset:z.number().int().min(0).optional()}).strict(),run:(a:any)=>workspace.comments(a),write:false},
  {name:'knowledge_history',description:'读取可见分支提交历史',schema:branch.extend({offset:z.number().int().min(0).default(0)}),run:(a:any)=>workspace.history(a.branch_id,a.offset),write:false},
  {name:'knowledge_request',description:'查询本人知识库操作的幂等回执',schema:z.object({request_id:z.uuid()}).strict(),run:async(a:any)=>({result:await workspace.receipt(a.request_id)}),write:false},
  ...([
   ['knowledge_create_branch','从主分支创建修改分支',s.branch,'createBranch'],
   ['knowledge_delete_branch','经创建者明确授权删除非主分支，关闭未完成审核并保留历史',s.deleteBranch,'deleteBranch'],
   ['knowledge_share_branch','经作者明确授权共享私人草稿分支',s.share,'shareBranch'],
   ['knowledge_save_document','在分支保存文档版本，可传 scopes 选择全组织通用、人事组内或本人个人范围，可省略标签保留已有标签',s.save,'save'],
   ['knowledge_edit_category','提议新标签，或提议修改已认可标签的名称和解释',s.categoryEdit,'editCategory'],
   ['knowledge_remove_document','在分支移除文档，保留历史',s.remove,'remove'],
   ['knowledge_define_category','提议修改已认可标签的解释',s.category,'defineCategory'],
   ['knowledge_propose_merge','为只含一篇文档改动的分支建立或更新七天合并请求',s.merge,'propose'],
   ['knowledge_agree','本人正式成员明确同意当前具体修改',s.approve,'approve'],
   ['knowledge_merge','核验三人门槛、候选选择及冲突后明确合入主分支',s.accept,'accept'],
   ['knowledge_resolve_conflict','明确保留主分支或分支版本，更新后重新征求同意',s.resolve,'resolveConflict'],
   ['knowledge_create_issue','建立独立问题或讨论',s.issue,'createIssue'],
   ['knowledge_issue_from_annotation','从可公开的文档或分类解释批注发起议题，保存原引用',s.issueFromComment,'issueFromComment'],
   ['knowledge_issue_conclusion','记录议题结论及可选的达标候选选择',s.issueState,'setIssueState'],
   ['knowledge_comment','发表普通评论、精确引用批注或回复',s.comment,'comment'],
  ] as const).map(([name,description,schema,method])=>({name,description,schema,run:(a:any)=>workspace[method](a),write:true})),
 ];
}
