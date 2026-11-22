import { KnowledgeError, uid } from "../types.ts";
import type { KnowledgeCategory } from "../../../app/shared/knowledge.ts";
import type { ServiceContext } from './context.ts';
import { getBranch, versionScopeFilter } from './records.ts';
import { runCommand } from './command.ts';
import { workspaceSchemas } from './inputs.ts';
export async function listCategories(context: ServiceContext, branchId = 'main', ids?: string[], scopeIds: string[] | null = null) {
  await getBranch(context, branchId);
  const documentScope = versionScopeFilter(scopeIds);
  const usage = `SELECT COUNT(*) FROM kw_items i JOIN kw_versions v ON v.id=i.version_id
    JOIN kw_document_tags t ON t.version_id=v.id WHERE i.branch_id=? AND t.category_id=c.id AND v.deleted=0 ${documentScope.clause}`;
  const selected = ids ? `AND c.id IN (${ids.map(() => '?').join(',')})` : '';
  // An older tag can have adopted uses but no independent entry or current documents.
  const formerUse = ids && !context.guest && branchId === 'main' ? `OR EXISTS(
    SELECT 1 FROM kw_document_tags t JOIN kw_changes ch ON ch.after_id=t.version_id
    JOIN kw_commits co ON co.id=ch.commit_id WHERE co.branch_id='main' AND t.category_id=visible.id)` : '';
  const rows = await context.stmt(`SELECT * FROM (SELECT c.*,(${usage}) AS count FROM kw_categories c
    WHERE (?=1 OR c.pending=0) ${selected}) visible WHERE (?=1 AND independent=1) OR count>0 ${formerUse} ORDER BY name`,
    branchId,...documentScope.args,context.showPendingTags ? 1 : 0,...(ids ?? []),context.guest ? 0 : 1).all<KnowledgeCategory>();
  return {categories:rows.results};
}
export async function getCategory(context: ServiceContext, branchId: string, id: string) {
  const found = (await listCategories(context, branchId)).categories.find(c => c.id === id);
  if (!found) throw new KnowledgeError(404, 'NOT_FOUND', '未找到这个标签');
  return found;
}
export async function prepareCategoryChanges(context: ServiceContext, a: {
  id?: string;
  branch_id: string;
  expected_version?: number;
  name?: string;
  definition: string;
}, at: string, draftCategory?: KnowledgeCategory) {
  let old = draftCategory ?? (a.id ? await getCategory(context, a.branch_id, a.id) : null);
  if (old && old.version !== a.expected_version) throw new KnowledgeError(409, 'CONFLICT', '标签已更新，请重新读取');
  const name = a.name ?? old!.name,
    duplicate = await context.stmt('SELECT id FROM kw_categories WHERE name=?', name).first<{
      id: string;
    }>();
  if (duplicate && !old && !a.id) {
    // A withdrawn new tag keeps its ID so that existing document links survive.
    // Any member may propose the name again without reading the author's draft.
    old = await context.stmt(`SELECT c.* FROM kw_categories c WHERE c.id=? AND c.pending=1 AND c.independent=0
      AND EXISTS(SELECT 1 FROM kw_tag_proposals p JOIN kw_tag_withdrawals w ON w.proposal_id=p.id WHERE p.category_id=c.id)`,duplicate.id).first<KnowledgeCategory>();
  }
  if (duplicate && duplicate.id !== old?.id) throw new KnowledgeError(409, 'CATEGORY_EXISTS', '已有同名标签，请选择它或使用其他名称');
  if (await context.stmt("SELECT 1 FROM kw_tag_proposals WHERE name=? AND state='pending' AND expires_at>? AND category_id<>?",name,at,old?.id ?? '').first())
    throw new KnowledgeError(409,'CATEGORY_EXISTS','已有同名标签正在等待认可');
  const id = old?.id ?? uid(), proposalId = uid();
  if (old && await context.stmt("SELECT 1 FROM kw_tag_proposals WHERE category_id=? AND state='pending' AND expires_at>?",id,at).first())
    throw new KnowledgeError(409,'TAG_PROPOSAL_OPEN','这个标签已有待认可的版本');
  const expiresAt = new Date(Date.parse(at) + 7 * 86400000).toISOString();
  const statements: D1PreparedStatement[] = [];
  if (!old) statements.push(context.stmt('INSERT INTO kw_categories(id,name,definition,independent,updated_at,pending) VALUES(?,?,?,1,?,1)',id,name,a.definition,at));
  else if (old.pending && (draftCategory || !a.id)) statements.push(context.stmt('UPDATE kw_categories SET independent=1,name=?,definition=?,updated_at=? WHERE id=?',name,a.definition,at,id));
  else statements.push(context.stmt('UPDATE kw_categories SET independent=1 WHERE id=?',id));
  statements.push(context.stmt("UPDATE kw_tag_proposals SET state='expired' WHERE category_id=? AND state='pending'",id),
    context.stmt('INSERT INTO kw_tag_proposals(id,category_id,name,definition,base_version,author_id,author_name,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
      proposalId,id,name,a.definition,old?.version ?? 1,context.actor.id,context.actor.name,at,expiresAt));
  return {statements,result:{id,proposal_id:proposalId,version:old?.version ?? 1,pending:old?.pending ?? 1,expires_at:expiresAt}};
}
export async function editCategory(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.categoryEdit.parse(input);
  return runCommand(context, a, 'category.edit', at => prepareCategoryChanges(context, a, at));
}
export async function defineCategory(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.category.parse(input);
  return runCommand(context, a, 'category.define', async at => {
    const category = await getCategory(context,a.branch_id,a.id);
    const branch = await getBranch(context,a.branch_id);
    if (branch.visibility==='private' && !await isCategoryPublic(context,a.id)) {
      throw new KnowledgeError(409,'PRIVATE_SOURCE','私人草稿中的标签尚未公开。若要共享其词义，请明确提议新标签。');
    }
    return prepareCategoryChanges(context,{...a,name:category.name},at);
  });
}
export async function isCategoryPublic(context: ServiceContext, id: string) {
  return !!(await context.stmt("SELECT 1 FROM kw_categories c WHERE c.id=? AND (?=1 OR c.pending=0) AND (c.independent=1 OR EXISTS(SELECT 1 FROM kw_items i JOIN kw_versions v ON v.id=i.version_id JOIN kw_branches b ON b.id=i.branch_id WHERE EXISTS(SELECT 1 FROM kw_document_tags t WHERE t.version_id=v.id AND t.category_id=c.id) AND v.deleted=0 AND b.visibility='members' AND b.state<>'closed'))", id, context.showPendingTags ? 1 : 0).first());
}
