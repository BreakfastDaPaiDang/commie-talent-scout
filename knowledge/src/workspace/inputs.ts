import { z } from 'zod';
export const key = z.string().min(1).max(180),
  request_id = z.uuid(),
  expected_version = z.number().int().positive();
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
    ...page
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
    category: z.string().trim().min(1).max(40),
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
    reason: z.string().trim().max(4000).default('提交审核'),
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
    parent_id: z.uuid().optional(),
    version_id: key.optional(),
    quote: z.string().min(1).max(4000).optional(),
    start_offset: z.number().int().min(0).optional(),
    end_offset: z.number().int().positive().optional(),
    body: z.string().trim().min(1).max(8000),
    request_id
  }).strict().refine(v => Number(!!v.document_id) + Number(!!v.category_id) + Number(!!v.issue_id) === 1, '请选择一个评论对象')
};
