import { z } from 'zod';
export const key = z.string().min(1).max(180),
  request_id = z.uuid(),
  expected_version = z.number().int().positive();
export const scope_id = z.union([z.enum(['org', 'hr']), z.templateLiteral(['personal:', z.uuid()])]);
export const branch_id = key.default('main'),
  page = {
    offset: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(40)
  };
export const workspaceSchemas = {
  list: z.object({
    branch_id,
    scope: z.enum(['main', 'public', 'drafts']).optional(),
    search: z.string().max(100).default(''),
    category_id: key.optional(),
    any_tag_ids: z.array(key).min(1).max(32).optional().describe('显式阅读范围。传入一个或多个已认可标签的 ID，返回匹配任一标签的已入库文档。'),
    scope_ids: z.array(scope_id).min(1).max(32).optional().describe('读取匹配任一所选文档范围的正文。用 org、hr 或 knowledge_reading_scopes 返回的个人范围 ID。'),
    all_scopes: z.boolean().optional().describe('设为 true 时显式读取所有可见的文档范围，与 scope_ids 二选一。'),
    ...page
  }).strict().refine(a => !a.any_tag_ids || (!a.category_id && a.branch_id === 'main' && (!a.scope || a.scope === 'main')),
    '按多个标签阅读时，请使用 main 并省略 category_id')
    .refine(a => !a.all_scopes || !a.scope_ids, '请在全部范围和指定范围中二选一'),
  readingScopes: z.object({search: z.string().trim().max(100).default(''), ...page}).strict(),
  setReadingDefaults: z.object({
    expected_version: z.number().int().min(0).describe('knowledge_reading_defaults 返回的当前版本。'),
    additional_scope_ids: z.array(scope_id).max(29).describe('此账号要补充的范围 ID。空数组清除已保存的补充范围。'),
    request_id
  }).strict(),
  branch: z.object({
    name: z.string().trim().min(1).max(80),
    visibility: z.enum(['private', 'members']).default('members'),
    request_id
  }).strict(),
  share: z.object({
    branch_id: key,
    expected_version,
    request_id
  }).strict(),
  deleteBranch: z.object({
    branch_id: key,
    expected_version,
    request_id
  }).strict(),
  save: z.object({
    branch_id: key,
    expected_version,
    document_id: z.uuid().optional(),
    title: z.string().trim().min(1).max(200),
    body: z.string().min(1).max(60000),
    category: z.string().trim().min(1).max(40).optional(),
    additional_tags: z.array(z.string().trim().min(1).max(40)).max(19).optional(),
    scopes: z.array(z.union([scope_id, z.literal('personal')])).min(1).max(3).optional()
      .describe('文档所属范围。使用 org、hr 或 personal（当前绑定的正式社员）。修订可原样保留原有个人范围。'),
    kind: z.string().trim().min(1).max(30).default('知识'),
    source: z.string().max(2000).default(''),
    message: z.string().trim().min(1).max(300),
    request_id
  }).strict(),
  remove: z.object({
    branch_id: key,
    expected_version,
    document_id: z.uuid(),
    message: z.string().trim().min(1).max(300),
    request_id
  }).strict(),
  category: z.object({
    id: z.uuid(),
    branch_id,
    expected_version,
    definition: z.string().max(4000),
    request_id
  }).strict(),
  categoryEdit: z.object({
    id: z.uuid().optional(),
    branch_id,
    expected_version: expected_version.optional(),
    name: z.string().trim().min(1).max(40),
    definition: z.string().max(4000).default(''),
    request_id
  }).strict(),
  review: z.object({
    branch_id: key,
    expected_version,
    document_id: z.uuid(),
    version_id: key,
    expected_publication: z.enum(['direct', 'review']).optional()
      .describe('明确确认的发布方式。仅本人新建或修订纯个人文档时可使用 direct。'),
    reason: z.string().trim().max(4000).optional(),
    request_id
  }).strict(),
  issueFromComment: z.object({
    comment_id: z.uuid(),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(12000),
    request_id
  }).strict(),
  merge: z.object({
    branch_id: key,
    expected_version,
    title: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(4000),
    request_id
  }).strict(),
  approve: z.object({
    id: z.uuid(),
    head_id: key,
    request_id
  }).strict(),
  accept: z.object({
    id: z.uuid(),
    head_id: key,
    main_version: expected_version,
    selection: z.discriminatedUnion('kind', [z.object({
      kind: z.literal('meeting'),
      notes: z.string().trim().min(1).max(4000)
    }), z.object({
      kind: z.literal('issue'),
      issue_id: z.uuid()
    })]).optional(),
    request_id
  }).strict(),
  resolve: z.object({
    branch_id: key,
    expected_version,
    document_id: z.uuid(),
    main_version: expected_version,
    choice: z.enum(['main', 'branch']),
    request_id
  }).strict(),
  issue: z.object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(12000),
    document_id: z.uuid().optional(),
    request_id
  }).strict(),
  issueState: z.object({
    id: z.uuid(),
    expected_version,
    state: z.enum(['open', 'closed']),
    resolution: z.string().trim().max(4000).default(''),
    selected_merge_id: z.uuid().optional(),
    request_id
  }).strict(),
  comment: z.object({
    branch_id: key.optional(),
    document_id: z.uuid().optional(),
    category_id: z.uuid().optional(),
    issue_id: z.uuid().optional(),
    review_id: z.uuid().optional(),
    head_id: key.optional(),
    parent_id: z.uuid().optional(),
    version_id: key.optional(),
    quote: z.string().min(1).max(4000).optional(),
    start_offset: z.number().int().min(0).optional(),
    end_offset: z.number().int().positive().optional(),
    body: z.string().trim().min(1).max(8000),
    request_id
  }).strict()
    .refine(v => Number(!!v.document_id) + Number(!!v.category_id) + Number(!!v.issue_id) === 1, '请选择一个评论对象')
    .refine(v => (!v.review_id && !v.head_id) || !!(v.review_id && v.head_id && v.document_id && v.branch_id), '请选择具体候选版本')
};
