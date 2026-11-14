import { KnowledgeError, uid } from "../types.ts";
import type { KnowledgeComment } from "../../../app/shared/knowledge.ts";
import type { ServiceContext } from './context.ts';
import { runCommand } from './command.ts';
import { getDocument, getBranch } from './records.ts';
import { isCategoryPublic, getCategory } from './categories.ts';
import { getIssue } from './issue-queries.ts';
import { qualifiedMerges } from './review-queries.ts';
import { workspaceSchemas } from './inputs.ts';
export async function createIssue(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.issue.parse(input);
  return runCommand(context, a, 'issue.create', async at => {
    if (a.document_id) await getDocument(context, 'main', a.document_id);
    const id = uid();
    return {
      statements: [context.stmt('INSERT INTO kw_issues(id,number,title,body,document_id,author_id,author_name,created_at,updated_at) VALUES(?,(SELECT COALESCE(MAX(number),0)+1 FROM kw_issues),?,?,?,?,?,?,?)', id, a.title, a.body, a.document_id ?? null, context.actor.id, context.actor.name, at, at)],
      result: {
        id
      }
    };
  });
}
export async function issueFromComment(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.issueFromComment.parse(input);
  return runCommand(context, a, 'issue.from_annotation', async at => {
    const c = await context.stmt('SELECT * FROM kw_comments WHERE id=?', a.comment_id).first<KnowledgeComment>();
    if (!c?.quote) throw new KnowledgeError(404, 'NOT_FOUND', '批注不存在或不可见');
    if (c.branch_id) {
      const b = await getBranch(context, c.branch_id);
      if (b.visibility === 'private') throw new KnowledgeError(409, 'PRIVATE_SOURCE', '请先将引用内容提交到公开，再发起议题');
    }
    let title: string;
    if (c.document_id) title = (await getDocument(context, c.branch_id!, c.document_id)).title;else if (c.category_id && (await isCategoryPublic(context, c.category_id))) title = (await context.stmt('SELECT name FROM kw_categories WHERE id=?', c.category_id).first<{
      name: string;
    }>())!.name;else throw new KnowledgeError(404, 'NOT_FOUND', '引用来源不可见');
    const source = {
        kind: c.category_id ? 'category' : 'document',
        title,
        branch_id: c.branch_id,
        document_id: c.document_id,
        category_id: c.category_id,
        version_id: c.version_id,
        quote: c.quote,
        comment: c.body,
        author_name: c.author_name
      },
      id = uid();
    return {
      statements: [context.stmt('INSERT INTO kw_issues(id,number,title,body,document_id,category_id,source_comment_id,source_json,author_id,author_name,created_at,updated_at) VALUES(?,(SELECT COALESCE(MAX(number),0)+1 FROM kw_issues),?,?,?,?,?,?,?,?,?,?)', id, a.title, a.body, c.document_id, c.category_id, c.id, JSON.stringify(source), context.actor.id, context.actor.name, at, at)],
      result: {
        id
      }
    };
  });
}
export async function setIssueState(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.issueState.parse(input);
  return runCommand(context, a, 'issue.state', async at => {
    const issue = await getIssue(context, a.id);
    if (issue.version !== a.expected_version) throw new KnowledgeError(409, 'CONFLICT', '议题已更新');
    if (a.state === 'closed' && !a.resolution) throw new KnowledgeError(400, 'RESOLUTION_REQUIRED', '请记录议题结论');
    let candidates: null | {
      id: string;
      head_id: string;
    }[] = null;
    if (a.selected_merge_id) {
      if (a.state !== 'closed') throw new KnowledgeError(400, 'CHOICE_REQUIRES_CONCLUSION', '请选择已形成结论的议题');
      const qualified = await qualifiedMerges(context);
      if (!qualified.some(m => m.id === a.selected_merge_id)) throw new KnowledgeError(409, 'CANDIDATE_NOT_QUALIFIED', '该候选尚未获得三名正式成员同意');
      candidates = qualified.map(m => ({
        id: m.id,
        head_id: m.head_id
      })).sort((a, b) => a.id.localeCompare(b.id));
    }
    return {
      statements: [context.stmt('UPDATE kw_issues SET state=?,resolution=?,selected_merge_id=?,candidates_json=?,version=version+1,updated_at=? WHERE id=?', a.state, a.resolution, a.selected_merge_id ?? null, candidates ? JSON.stringify(candidates) : null, at, a.id)],
      result: {
        id: a.id,
        version: issue.version + 1
      }
    };
  });
}
export async function listComments(context: ServiceContext, query: {
  branch_id?: string;
  document_id?: string;
  category_id?: string;
  issue_id?: string;
  offset?: number;
}) {
  let where: string, args: unknown[];
  if (query.document_id) {
    await getDocument(context, query.branch_id ?? 'main', query.document_id);
    where = 'branch_id=? AND document_id=?';
    args = [query.branch_id ?? 'main', query.document_id];
  } else if (query.category_id) {
    await getCategory(context, query.branch_id ?? 'main', query.category_id);
    where = "category_id=? AND (branch_id IS NULL OR branch_id=? OR (?=0 AND branch_id IN (SELECT id FROM kw_branches WHERE visibility='members' AND state<>'closed')))";
    args = [query.category_id, query.branch_id ?? 'main', context.guest ? 1 : 0];
  } else if (query.issue_id) {
    await getIssue(context, query.issue_id);
    where = 'issue_id=?';
    args = [query.issue_id];
  } else throw new KnowledgeError(400, 'COMMENT_TARGET_REQUIRED', '请选择评论对象');
  const rows = await context.stmt(`SELECT * FROM kw_comments WHERE ${where} ORDER BY created_at,id LIMIT 101 OFFSET ?`, ...args, query.offset ?? 0).all<KnowledgeComment>();
  return {
    comments: rows.results.slice(0, 100),
    next_offset: rows.results.length > 100 ? (query.offset ?? 0) + 100 : null
  };
}
export async function addComment(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.comment.parse(input);
  return runCommand(context, a, 'comment.create', async at => {
    let branchId = a.document_id || a.category_id ? a.branch_id ?? 'main' : null,
      prefix: string | null = null,
      suffix: string | null = null;
    const category = a.category_id ? await getCategory(context, a.branch_id ?? 'main', a.category_id) : null;
    const text = a.document_id ? await getDocument(context, branchId!, a.document_id) : category ? {
      id: category.definition_version_id,
      body: category.definition
    } : null;
    if (category && (await isCategoryPublic(context, category.id))) branchId = null;
    if (text) {
      if (a.quote !== undefined) {
        if (a.version_id !== text.id || a.start_offset === undefined || a.end_offset === undefined || a.end_offset > text.body.length || a.end_offset <= a.start_offset || text.body.slice(a.start_offset, a.end_offset) !== a.quote) throw new KnowledgeError(409, 'QUOTE_CHANGED', '引用原文已变化，请重新选择');
        prefix = text.body.slice(Math.max(0, a.start_offset - 40), a.start_offset);
        suffix = text.body.slice(a.end_offset, a.end_offset + 40);
      } else if (a.version_id || a.start_offset !== undefined || a.end_offset !== undefined) throw new KnowledgeError(400, 'QUOTE_REQUIRED', '批注必须包含原文');
    } else if (a.quote !== undefined || a.version_id || a.start_offset !== undefined || a.end_offset !== undefined) throw new KnowledgeError(400, 'DOCUMENT_QUOTE_REQUIRED', '只能引用文档或分类解释');
    if (a.issue_id) await getIssue(context, a.issue_id);
    let parent: KnowledgeComment | null = null;
    if (a.parent_id) {
      parent = await context.stmt('SELECT * FROM kw_comments WHERE id=?', a.parent_id).first<KnowledgeComment>();
      if (parent?.category_id && parent.category_id === a.category_id && parent.branch_id) {
        await getBranch(context, parent.branch_id);
        branchId = parent.branch_id;
      }
      if (!parent || parent.document_id !== (a.document_id ?? null) || parent.branch_id !== branchId || parent.category_id !== (a.category_id ?? null) || parent.issue_id !== (a.issue_id ?? null)) throw new KnowledgeError(400, 'PARENT_MISMATCH', '回复对象不属于这条讨论');
    }
    const id = uid();
    return {
      statements: [context.stmt('INSERT INTO kw_comments VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, branchId, a.document_id ?? null, a.category_id ?? null, a.issue_id ?? null, parent?.id ?? null, parent?.version_id ?? a.version_id ?? null, parent?.quote ?? a.quote ?? null, parent?.start_offset ?? a.start_offset ?? null, parent?.end_offset ?? a.end_offset ?? null, parent?.prefix ?? prefix, parent?.suffix ?? suffix, a.body, context.actor.id, context.actor.name, at)],
      result: {
        id
      }
    };
  });
}
