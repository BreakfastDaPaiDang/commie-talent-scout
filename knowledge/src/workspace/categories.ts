import { KnowledgeError, uid } from "../types.ts";
import type { KnowledgeCategory } from "../../../app/shared/knowledge.ts";
import type { ServiceContext } from './context.ts';
import { getBranch } from './records.ts';
import { runCommand } from './command.ts';
import { expected_version, branch_id, workspaceSchemas } from './inputs.ts';
export async function listCategories(context: ServiceContext, branchId = 'main') {
  await getBranch(context, branchId);
  const rows = await context.stmt('SELECT c.*,(SELECT COUNT(*) FROM kw_items i JOIN kw_versions v ON v.id=i.version_id WHERE i.branch_id=? AND v.category_id=c.id AND v.deleted=0) AS count FROM kw_categories c WHERE (?=0 AND c.independent=1) OR EXISTS(SELECT 1 FROM kw_items i JOIN kw_versions v ON v.id=i.version_id WHERE i.branch_id=? AND v.category_id=c.id AND v.deleted=0) ORDER BY c.name', branchId, context.guest ? 1 : 0, branchId).all<KnowledgeCategory>();
  return {
    categories: rows.results
  };
}
export async function getCategory(context: ServiceContext, branchId: string, id: string) {
  const found = (await listCategories(context, branchId)).categories.find(c => c.id === id);
  if (!found) throw new KnowledgeError(404, 'NOT_FOUND', '当前分支没有这个分类的文档');
  return found;
}
export async function prepareCategoryChanges(context: ServiceContext, a: {
  id?: string;
  branch_id: string;
  expected_version?: number;
  name?: string;
  definition: string;
}, at: string) {
  const old = a.id ? await getCategory(context, a.branch_id, a.id) : null;
  if (old && old.version !== a.expected_version) throw new KnowledgeError(409, 'CONFLICT', '分类已更新，请重新读取');
  const name = a.name ?? old!.name,
    duplicate = await context.stmt('SELECT id FROM kw_categories WHERE name=?', name).first<{
      id: string;
    }>();
  if (duplicate && duplicate.id !== old?.id) throw new KnowledgeError(409, 'CATEGORY_EXISTS', '已有同名分类，请选择它或使用其他名称');
  const id = old?.id ?? uid(),
    versionId = uid(),
    documentId = 'category-' + id,
    statements: D1PreparedStatement[] = [];
  if (!old) statements.push(context.stmt('INSERT INTO kw_categories(id,name,definition,independent,updated_at) VALUES(?,?,?,1,?)', id, name, a.definition, at));
  statements.push(context.stmt('INSERT OR IGNORE INTO kw_documents VALUES(?,?,?,?)', documentId, context.actor.id, context.actor.name, at), context.stmt('INSERT INTO kw_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)', versionId, documentId, name, a.definition, id, '分类解释', '', 0, context.actor.id, context.actor.name, at), context.stmt('UPDATE kw_categories SET name=?,definition=?,definition_version_id=?,version=?,updated_at=? WHERE id=?', name, a.definition, versionId, old ? old.version + 1 : 1, at, id));
  return {
    statements,
    result: {
      id,
      version: old ? old.version + 1 : 1,
      definition_version_id: versionId
    }
  };
}
export async function editCategory(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.categoryEdit.parse(input);
  return runCommand(context, a, 'category.edit', at => prepareCategoryChanges(context, a, at));
}
export async function defineCategory(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.category.parse(input);
  return runCommand(context, a, 'category.define', at => prepareCategoryChanges(context, a, at));
}
export async function isCategoryPublic(context: ServiceContext, id: string) {
  return !!(await context.stmt("SELECT 1 FROM kw_categories c WHERE c.id=? AND (c.independent=1 OR EXISTS(SELECT 1 FROM kw_items i JOIN kw_versions v ON v.id=i.version_id JOIN kw_branches b ON b.id=i.branch_id WHERE v.category_id=c.id AND v.deleted=0 AND b.visibility='members' AND b.state<>'closed'))", id).first());
}
