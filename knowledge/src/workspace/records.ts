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
export const commitAncestry = `ancestry(id) AS (
  SELECT ?
  UNION SELECT c.parent_id FROM kw_commits c JOIN ancestry a ON c.id=a.id WHERE c.parent_id IS NOT NULL
  UNION SELECT c.merge_parent_id FROM kw_commits c JOIN ancestry a ON c.id=a.id WHERE c.merge_parent_id IS NOT NULL
)`;

// Published ancestry remains readable after a source branch is closed.
export function commitVisibility(context: ServiceContext) {
  return context.guest
    ? {where: "c.branch_id='main'", args: []}
    : {where: "(origin.visibility='members' OR origin.owner_id=?)", args: [context.actor.id]};
}
export function assertEditable(context: ServiceContext, b: KnowledgeBranch, version: number) {
  assertWriter(context);
  if (b.id === 'main') throw new KnowledgeError(403, 'MAIN_REQUIRES_MERGE', '请先在分支中修改，再提出合并请求');
  if (b.state !== 'open') throw new KnowledgeError(409, 'BRANCH_CLOSED', '该分支已经结束，请新建分支');
  if (b.version !== version) throw new KnowledgeError(409, 'CONFLICT', '分支已变化，请刷新后核对');
}
// A document added and removed within one branch has no change to publish.
export const changedDocument = '(i.version_id IS NOT i.base_version_id AND (i.base_version_id IS NOT NULL OR v.deleted=0))';

export function visibleTag(context: ServiceContext, alias: string) {
  return context.showPendingTags ? '1=1' : alias + '.pending=0';
}

export const versionTags = (context: ServiceContext) => `(SELECT json_group_array(json_object('id', c.id, 'name', c.name${context.showPendingTags ? ", 'pending', c.pending" : ''}) ORDER BY t.position)
  FROM kw_document_tags t JOIN kw_categories c ON c.id=t.category_id WHERE t.version_id=v.id AND ${visibleTag(context, 'c')})`;

export const tagProjection = (context: ServiceContext) => `${versionTags(context)} AS tags_json`;
export const versionScopes = `(SELECT CASE WHEN COUNT(*)=0 THEN json_array('hr')
  ELSE json_group_array(s.scope_id ORDER BY CASE s.scope_id WHEN 'org' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END, s.scope_id) END
  FROM kw_version_scopes s WHERE s.version_id=v.id)`;
export const versionPersonalScopeName = `(SELECT s.scope_name FROM kw_version_scopes s WHERE s.version_id=v.id AND s.scope_name IS NOT NULL)`;
export const scopeProjection = `${versionScopes} AS scopes_json,${versionPersonalScopeName} AS personal_scope_name`;

export function versionScopeFilter(scopeIds: string[] | null) {
  if (!scopeIds) return {clause: '', args: []};
  const inheritedHr = scopeIds.includes('hr') ? 'OR NOT EXISTS(SELECT 1 FROM kw_version_scopes s WHERE s.version_id=v.id)' : '';
  return {
    clause: `AND (EXISTS(SELECT 1 FROM kw_version_scopes s WHERE s.version_id=v.id
      AND s.scope_id IN (SELECT value FROM json_each(?))) ${inheritedHr})`,
    args: [JSON.stringify(scopeIds)]
  };
}

export type TaggedRow = Omit<KnowledgeVersion, 'scopes'> & {tags_json: string; scopes_json: string; visible_category_id: string | null};
export function withTags({tags_json, scopes_json, visible_category_id, ...version}: TaggedRow): KnowledgeVersion {
  return {...version, category_id: visible_category_id, tags: JSON.parse(tags_json), scopes: JSON.parse(scopes_json)};
}
export async function getDocument(context: ServiceContext, branchId: string, id: string, includeRemoved = false) {
  return (await getDocumentRecord(context, branchId, id, undefined, includeRemoved)).document;
}

export async function getDocumentRecord(context: ServiceContext, branchId: string, id: string, versionId?: string, includeRemoved = false) {
  const branch = await getBranch(context, branchId);
  const projection = `v.*,i.version_id AS current_version_id,c.id AS visible_category_id,c.name AS category_name,${tagProjection(context)},${scopeProjection}`;
  const category = `LEFT JOIN kw_categories c ON c.id=v.category_id AND ${visibleTag(context, 'c')}`;
  type DocumentRow = TaggedRow & {current_version_id: string | null};
  // Follow the branch's own history. Merge parents may contain versions never adopted by this branch.
  const row = versionId === undefined
    ? await context.stmt(`SELECT ${projection} FROM kw_items i JOIN kw_versions v ON v.id=i.version_id
      ${category} WHERE i.branch_id=? AND i.document_id=?`, branchId, id).first<DocumentRow>()
    : await context.stmt(`WITH RECURSIVE history(id) AS (
      SELECT head_id FROM kw_branches WHERE id=?
      UNION SELECT c.parent_id FROM history h JOIN kw_commits c ON c.id=h.id WHERE c.parent_id IS NOT NULL
    ) SELECT ${projection} FROM kw_versions v
      JOIN kw_branches b ON b.id=? AND b.state<>'closed'
      LEFT JOIN kw_items i ON i.branch_id=b.id AND i.document_id=v.document_id ${category}
      WHERE v.id=? AND v.document_id=? AND (v.id=i.version_id OR EXISTS(
        SELECT 1 FROM history h JOIN kw_changes x ON x.commit_id=h.id WHERE x.document_id=v.document_id AND x.after_id=v.id
      ))`, branchId, branchId, versionId, id).first<DocumentRow>();
  if (!row || row.deleted && !includeRemoved) throw new KnowledgeError(404, 'NOT_FOUND', versionId === undefined
    ? '文档不存在或已在此分支移除' : '文档版本不存在或不可见');
  const {current_version_id, ...tagged} = row;
  return {branch, document: withTags(tagged), historical: current_version_id !== row.id};
}
export async function getVersion(context: ServiceContext, id: string | null) {
  const definitionVisible = context.showPendingTags ? '1=1' : `NOT EXISTS(SELECT 1 FROM kw_categories hidden
    WHERE hidden.id=v.category_id AND hidden.pending=1 AND v.document_id='category-'||hidden.id)`;
  const row = id ? await context.stmt(`SELECT v.*,c.id AS visible_category_id,c.name AS category_name,${tagProjection(context)},${scopeProjection}
    FROM kw_versions v LEFT JOIN kw_categories c ON c.id=v.category_id AND ${visibleTag(context, 'c')}
    WHERE v.id=? AND ${definitionVisible}`, id).first<TaggedRow>() : null;
  return row ? withTags(row) : null;
}
export function prepareCommit(context: ServiceContext, id: string, b: KnowledgeBranch, message: string, at: string, mergeParent: string | null = null) {
  return context.stmt('INSERT INTO kw_commits VALUES(?,?,?,?,?,?,?,?)', id, b.id, b.head_id, mergeParent, message, context.actor.id, context.actor.name, at);
}
