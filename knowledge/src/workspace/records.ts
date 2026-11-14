import { KnowledgeError } from "../types.ts";
import type { KnowledgeBranch, KnowledgeVersion } from "../../../app/shared/knowledge.ts";
import type { ServiceContext } from './context.ts';
export function assertWriter(context: ServiceContext) {
  if (context.guest || !context.actor.eligible) throw new KnowledgeError(403, 'FORMAL_MEMBER_REQUIRED', '仅正式成员可以修改或发表评论');
}
export async function getBranch(context: ServiceContext, id: string) {
  const b = await context.stmt('SELECT * FROM kw_branches WHERE id=?', id).first<KnowledgeBranch>();
  if (!b || b.state === 'closed' || context.guest && id !== 'main' || b.visibility === 'private' && b.owner_id !== context.actor.id) throw new KnowledgeError(404, 'NOT_FOUND', '分支不存在或不可见');
  return b;
}
export function assertEditable(context: ServiceContext, b: KnowledgeBranch, version: number) {
  assertWriter(context);
  if (b.id === 'main') throw new KnowledgeError(403, 'MAIN_REQUIRES_MERGE', '请先在分支中修改，再提出合并请求');
  if (b.state !== 'open') throw new KnowledgeError(409, 'BRANCH_CLOSED', '该分支已经结束，请新建分支');
  if (b.version !== version) throw new KnowledgeError(409, 'CONFLICT', '分支已变化，请刷新后核对');
}
export async function getDocument(context: ServiceContext, branchId: string, id: string) {
  await getBranch(context, branchId);
  const v = await context.stmt('SELECT v.*,c.name AS category_name FROM kw_items i JOIN kw_versions v ON v.id=i.version_id LEFT JOIN kw_categories c ON c.id=v.category_id WHERE i.branch_id=? AND i.document_id=?', branchId, id).first<KnowledgeVersion>();
  if (!v || v.deleted) throw new KnowledgeError(404, 'NOT_FOUND', '文档不存在或已在此分支移除');
  return v;
}
export async function getVersion(context: ServiceContext, id: string | null) {
  return id ? await context.stmt('SELECT v.*,c.name AS category_name FROM kw_versions v LEFT JOIN kw_categories c ON c.id=v.category_id WHERE v.id=?', id).first<KnowledgeVersion>() : null;
}
export function prepareCommit(context: ServiceContext, id: string, b: KnowledgeBranch, message: string, at: string, mergeParent: string | null = null) {
  return context.stmt('INSERT INTO kw_commits VALUES(?,?,?,?,?,?,?,?)', id, b.id, b.head_id, mergeParent, message, context.actor.id, context.actor.name, at);
}
