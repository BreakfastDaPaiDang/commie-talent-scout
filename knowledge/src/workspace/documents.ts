import { KnowledgeError, uid } from "../types.ts";
import type { KnowledgeBranch, KnowledgeVersion, KnowledgeCategory, KnowledgeDiff } from "../../../app/shared/knowledge.ts";
import type { ServiceContext } from './context.ts';
import { getBranch, getDocument, assertEditable, prepareCommit, getVersion, changedDocument, tagProjection, visibleTag, withTags, type TaggedRow } from './records.ts';
import { listCategories } from './categories.ts';
import { runCommand } from './command.ts';
import { workspaceSchemas } from './inputs.ts';
import { reviewSourceMatches, reviewVisible, singleDocumentBranch } from './review-queries.ts';

async function approvedTagRevision(context: ServiceContext) {
  return await context.stmt("SELECT COUNT(*) AS revision FROM kw_tag_proposals WHERE state='approved'").first<number>('revision') ?? 0;
}

export async function listDocuments(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.list.parse(input);
  if (context.guest && a.scope && a.scope !== 'main') throw new KnowledgeError(403, 'PUBLISHED_ONLY', '接收者只能阅读主要知识库');
  const tagRevision = await approvedTagRevision(context);
  const branch = await getBranch(context, a.scope === 'main' ? 'main' : a.branch_id),
    pattern = '%' + a.search.replace(/[!%_]/g, '!$&') + '%';
  const at = context.clock();
  let scope = 'i.branch_id=?',
    scopeArgs: unknown[] = [branch.id];
  if (a.scope === 'drafts') {
    scope = `b.visibility='private' AND b.owner_id=? AND b.state='open' AND ${changedDocument}
      AND NOT EXISTS(SELECT 1 FROM kw_review_sources s JOIN kw_merges m ON m.id=s.merge_id JOIN kw_branches b ON b.id=m.branch_id
        WHERE s.source_branch_id=i.branch_id AND s.document_id=i.document_id AND s.source_version_id=i.version_id
          AND ${reviewSourceMatches}
          AND (m.state='merged' OR (m.state='open' AND m.head_id=b.head_id AND ${singleDocumentBranch} AND ${reviewVisible})))`;
    scopeArgs = [context.actor.id, at];
  }
  if (a.scope === 'public') {
    scope = `b.visibility='members' AND b.state='open' AND ${changedDocument} AND ${singleDocumentBranch}
      AND EXISTS(SELECT 1 FROM kw_merges m WHERE m.branch_id=b.id AND m.state='open' AND m.head_id=b.head_id AND ${reviewVisible})`;
    scopeArgs = [at];
  }
  const from = `FROM kw_items i JOIN kw_branches b ON b.id=i.branch_id JOIN kw_versions v ON v.id=i.version_id LEFT JOIN kw_categories c ON c.id=v.category_id AND ${visibleTag(context, 'c')}`;
  const where = `${scope} AND v.deleted=0 AND (? IS NULL OR EXISTS(SELECT 1 FROM kw_document_tags t JOIN kw_categories filter_tag ON filter_tag.id=t.category_id WHERE t.version_id=v.id AND t.category_id=? AND ${visibleTag(context, 'filter_tag')})) AND (v.title LIKE ? ESCAPE '!' OR v.body LIKE ? ESCAPE '!')`,
    args = [...scopeArgs, a.category_id ?? null, a.category_id ?? null, pattern, pattern];
  const rows = await context.stmt(`SELECT v.*,i.branch_id,c.id AS visible_category_id,c.name AS category_name,${tagProjection(context)} ${from} WHERE ${where} ORDER BY v.created_at DESC,v.id,i.branch_id LIMIT ? OFFSET ?`, ...args, a.limit + 1, a.offset).all<TaggedRow>();
  const categories = a.scope === 'public' || a.scope === 'drafts' ? (await context.stmt(`SELECT c.*,COUNT(*) AS count FROM kw_items i JOIN kw_branches b ON b.id=i.branch_id JOIN kw_versions v ON v.id=i.version_id JOIN kw_document_tags t ON t.version_id=v.id JOIN kw_categories c ON c.id=t.category_id WHERE ${scope} AND v.deleted=0 AND ${visibleTag(context, 'c')} GROUP BY c.id ORDER BY c.name`, ...scopeArgs).all<KnowledgeCategory>()).results : (await listCategories(context, branch.id)).categories;
  if (!context.guest && (a.scope === 'public' || a.scope === 'drafts')) for (const c of (await context.stmt(`SELECT c.*,0 AS count FROM kw_categories c WHERE c.independent=1 AND ${visibleTag(context, 'c')} ORDER BY c.name`).all<KnowledgeCategory>()).results) if (!categories.some(x => x.id === c.id)) categories.push(c);
  if (!context.showPendingTags && (tagRevision !== await approvedTagRevision(context) || branch.head_id !== (await getBranch(context, branch.id)).head_id)) {
    throw new KnowledgeError(409, 'KNOWLEDGE_SNAPSHOT_CHANGED', '知识库在读取时发生变化，请从第一页重新读取');
  }
  return {
    branch,
    tag_revision: tagRevision,
    documents: rows.results.slice(0, a.limit).map(withTags),
    next_offset: rows.results.length > a.limit ? a.offset + a.limit : null,
    categories
  };
}
export async function readDocument(context: ServiceContext, branchId: string, id: string) {
  const document = await getDocument(context, branchId, id);
  return {
    document
  };
}
export async function saveDocument(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.save.parse(input);
  return runCommand(context, a, 'document.save', async at => {
    const b = await getBranch(context, a.branch_id);
    assertEditable(context, b, a.expected_version);
    const old = a.document_id ? await getDocument(context, b.id, a.document_id) : null;
    const previousTags = old ? (await context.stmt(`SELECT t.category_id,t.position,c.pending FROM kw_document_tags t
      JOIN kw_categories c ON c.id=t.category_id WHERE t.version_id=? ORDER BY t.position`, old.id)
      .all<{category_id:string;position:number;pending:number}>()).results : [];
    const category = a.category ? await context.stmt(
      `SELECT c.id FROM kw_categories c WHERE c.name=? AND ${visibleTag(context, 'c')}`, a.category
    ).first<{id:string}>() : null;
    if (a.category && !category && !context.showPendingTags) {
      throw new KnowledgeError(400, 'TAG_NOT_FOUND', '标签不可用，请重新选择');
    }
    const categoryId = a.category ? category?.id ?? uid() : previousTags.find(tag => tag.position === 0)?.category_id ?? null;
    const documentId = old?.document_id ?? uid(),
      versionId = uid(),
      commitId = uid(),
      statements: D1PreparedStatement[] = [];
    if (a.category && !category) statements.push(context.stmt('INSERT INTO kw_categories(id,name,updated_at,pending) VALUES(?,?,?,1)', categoryId, a.category, at));
    if (!old) statements.push(context.stmt('INSERT INTO kw_documents VALUES(?,?,?,?)', documentId, context.actor.id, context.actor.name, at));
    statements.push(context.stmt('INSERT INTO kw_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)', versionId, documentId, a.title, a.body, categoryId, a.kind, a.source, 0, context.actor.id, context.actor.name, at), prepareCommit(context, commitId, b, a.message, at), context.stmt('INSERT INTO kw_changes VALUES(?,?,?,?)', commitId, documentId, old?.id ?? null, versionId), context.stmt('INSERT INTO kw_items(branch_id,document_id,version_id) VALUES(?,?,?) ON CONFLICT(branch_id,document_id) DO UPDATE SET version_id=excluded.version_id', b.id, documentId, versionId), context.stmt('UPDATE kw_branches SET head_id=?,version=version+1,updated_at=? WHERE id=?', commitId, at, b.id));
    const additionalIds = new Set<string>();
    if (a.additional_tags?.length) {
      const visible = (await listCategories(context, b.id)).categories;
      const known = new Map(visible.map(tag => [tag.name, tag.id]));
      for (const name of a.additional_tags) {
        if (name === a.category) continue;
        const id = known.get(name);
        if (!id) throw new KnowledgeError(400, 'TAG_NOT_FOUND', '标签不可用，请重新选择');
        additionalIds.add(id);
      }
    }
    for (const tag of previousTags) {
      const kept = tag.position > 0 && a.additional_tags === undefined;
      const hidden = !context.showPendingTags && tag.pending;
      if (kept || hidden) additionalIds.add(tag.category_id);
    }
    if (categoryId) additionalIds.delete(categoryId);
    for (const [index, id] of [...additionalIds].entries()) statements.push(context.stmt('INSERT INTO kw_version_tags VALUES(?,?,?)', versionId, id, index + 1));
    return {
      statements,
      result: {
        id: documentId,
        version_id: versionId,
        commit_id: commitId,
        branch_id: b.id,
        version: b.version + 1
      }
    };
  });
}
export async function removeDocument(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.remove.parse(input);
  return runCommand(context, a, 'document.remove', async at => {
    const b = await getBranch(context, a.branch_id);
    assertEditable(context, b, a.expected_version);
    const v = await getDocument(context, b.id, a.document_id),
      version = uid(),
      commit = uid();
    return {
      statements: [context.stmt('INSERT INTO kw_versions SELECT ?,document_id,title,body,category_id,kind,source,1,?,?,? FROM kw_versions WHERE id=?', version, context.actor.id, context.actor.name, at, v.id), context.stmt('INSERT INTO kw_version_tags SELECT ?,category_id,position FROM kw_version_tags WHERE version_id=?', version, v.id), prepareCommit(context, commit, b, a.message, at), context.stmt('INSERT INTO kw_changes VALUES(?,?,?,?)', commit, v.document_id, v.id, version), context.stmt('UPDATE kw_items SET version_id=? WHERE branch_id=? AND document_id=?', version, b.id, v.document_id), context.stmt('UPDATE kw_branches SET head_id=?,version=version+1,updated_at=? WHERE id=?', commit, at, b.id)],
      result: {
        id: v.document_id,
        branch_id: b.id,
        version: b.version + 1
      }
    };
  });
}
export async function branchDiff(context: ServiceContext, branchId: string): Promise<{
  branch: KnowledgeBranch;
  main: KnowledgeBranch;
  changes: KnowledgeDiff[];
}> {
  const branch = await getBranch(context, branchId),
    main = await getBranch(context, 'main');
  if (branch.id === 'main') return {
    branch,
    main,
    changes: []
  };
  const items = (await context.stmt(`SELECT i.document_id,i.version_id,i.base_version_id,m.version_id AS current_id
    FROM kw_items i JOIN kw_versions v ON v.id=i.version_id LEFT JOIN kw_items m ON m.branch_id='main' AND m.document_id=i.document_id
    WHERE i.branch_id=? AND ${changedDocument}`, branchId).all<{
    document_id: string;
    version_id: string;
    base_version_id: string | null;
    current_id: string | null;
  }>()).results;
  const changes: KnowledgeDiff[] = [];
  for (const item of items) {
    const proposed = (await getVersion(context, item.version_id))!,
      base = await getVersion(context, item.base_version_id),
      current = await getVersion(context, item.current_id);
    changes.push({
      document_id: item.document_id,
      base,
      current,
      proposed,
      conflict: item.current_id !== item.base_version_id && item.current_id !== item.version_id
    });
  }
  return {
    branch,
    main,
    changes
  };
}
