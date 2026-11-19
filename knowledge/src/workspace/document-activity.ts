import type { KnowledgeActivity, KnowledgeActivityPage, KnowledgeComment, KnowledgeDocumentTarget } from '../../../app/shared/knowledge.ts';
import { KnowledgeError } from '../types.ts';
import type { ServiceContext } from './context.ts';
import { changedDocument, commitAncestry, commitVisibility, getBranch, getDocument } from './records.ts';

type ReviewDocument = {
  version_id: string;
  body: string;
  legacy_comments: number;
};

const legacyReviewComments = (document: string, version: string) => `m.auto_promote=1 AND NOT EXISTS(
  SELECT 1 FROM kw_changes prior JOIN kw_commits c ON c.id=prior.commit_id
  WHERE c.branch_id=b.id AND prior.document_id=${document} AND prior.after_id<>${version}
)`;

// The main branch can link to only the public version actually selected in each merge.
export const publishedDocumentReviews = `SELECT DISTINCT m.*, x.after_id AS document_version_id,
    ${legacyReviewComments('x.document_id', 'x.after_id')} AS legacy_comments
  FROM ancestry a JOIN kw_commits c ON c.id=a.id
  JOIN kw_changes x ON x.commit_id=c.id
  JOIN kw_merges m ON m.head_id=c.merge_parent_id AND m.merged_at=c.created_at
  JOIN kw_commits head ON head.id=m.head_id AND head.branch_id=m.branch_id
  JOIN kw_branches b ON b.id=m.branch_id
  WHERE c.branch_id='main' AND x.document_id=? AND m.state='merged' AND b.visibility='members'`;
const publishedComment = `r.branch_id=c.branch_id
  AND (r.document_version_id=c.version_id OR (r.legacy_comments=1 AND c.version_id IS NULL))`;

export async function acceptedCommentVersion(context: ServiceContext, comment: KnowledgeComment) {
  if (context.guest || !comment.document_id || !comment.branch_id || comment.branch_id === 'main') return null;
  const main = await getBranch(context, 'main');
  return context.stmt(`WITH RECURSIVE ${commitAncestry}, document_reviews AS (${publishedDocumentReviews})
    SELECT r.document_version_id FROM document_reviews r JOIN kw_comments c ON ${publishedComment} WHERE c.id=?`,
    main.head_id, comment.document_id, comment.id).first<string>('document_version_id');
}

export async function getReviewDocument(context: ServiceContext, target: KnowledgeDocumentTarget) {
  if (!target.review_id && !target.head_id) return null;
  const review = !context.guest && target.review_id && target.head_id && await context.stmt(`
    SELECT v.id AS version_id, v.body,
      ${legacyReviewComments('i.document_id', 'v.id')} AS legacy_comments
    FROM kw_merges m JOIN kw_branches b ON b.id=m.branch_id
    JOIN kw_items i ON i.branch_id=b.id JOIN kw_versions v ON v.id=i.version_id
    WHERE m.id=? AND b.id=? AND m.head_id=? AND b.head_id=m.head_id
      AND b.visibility='members' AND b.state<>'closed' AND i.document_id=? AND ${changedDocument}
  `, target.review_id, target.branch_id, target.head_id, target.document_id).first<ReviewDocument>();
  if (!review) throw new KnowledgeError(404, 'NOT_FOUND', '候选版本不存在、已更新或不可见');
  return review;
}

export function documentCommentScope(target: KnowledgeDocumentTarget, review: ReviewDocument | null, includePublished = false) {
  const where = includePublished
    ? `(c.branch_id=? OR EXISTS(SELECT 1 FROM document_reviews r WHERE ${publishedComment})) AND c.document_id=?`
    : 'c.branch_id=? AND c.document_id=?';
  const args = [target.branch_id, target.document_id];
  // Earlier writers left ordinary comments unversioned. A dedicated review branch
  // with one document version gives them an unambiguous source.
  return review ? {
    where: where + ' AND (c.version_id=? OR (?=1 AND c.version_id IS NULL))',
    args: [...args, review.version_id, review.legacy_comments],
  } : {where, args};
}

const pageSize = 40;

function activityCursor(raw: string | undefined): [string | null, string | null] {
  if (!raw) return [null, null];
  try {
    const cursor = JSON.parse(raw) as unknown;
    if (Array.isArray(cursor) && cursor.length === 2 && cursor.every(part => typeof part === 'string' && part.length > 0)) {
      return [cursor[0], cursor[1]];
    }
  } catch {
    // Return the same client error for an invalid cursor and for an invalid shape.
  }
  throw new KnowledgeError(400, 'INVALID_CURSOR', '评论与历史的翻页位置无效');
}

export async function listDocumentActivity(
  context: ServiceContext, target: KnowledgeDocumentTarget, cursor?: string,
): Promise<KnowledgeActivityPage> {
  const [before, beforeId] = activityCursor(cursor);
  const review = await getReviewDocument(context, target);
  const branch = await getBranch(context, target.branch_id);
  if (!review) await getDocument(context, branch.id, target.document_id);
  const comments = documentCommentScope(target, review, !review && branch.id === 'main' && !context.guest);
  const visible = commitVisibility(context);
  const commits = review ? {
    sql: `SELECT c.* FROM ancestry a JOIN kw_commits c ON c.id=a.id JOIN kw_changes x ON x.commit_id=c.id
      WHERE c.branch_id=? AND x.document_id=? AND x.after_id=?
      UNION ALL
      SELECT c.* FROM kw_merges m JOIN kw_commits c ON c.merge_parent_id=m.head_id AND c.created_at=m.merged_at
      JOIN kw_changes x ON x.commit_id=c.id
      WHERE m.id=? AND m.head_id=? AND m.state='merged' AND c.branch_id='main' AND x.document_id=? AND x.after_id=?`,
    args: [branch.id, target.document_id, review.version_id, target.review_id, target.head_id, target.document_id, review.version_id],
  } : {
    sql: `SELECT c.* FROM ancestry a JOIN kw_commits c ON c.id=a.id JOIN kw_branches origin ON origin.id=c.branch_id
      JOIN kw_changes x ON x.commit_id=c.id WHERE x.document_id=? AND ${visible.where}`,
    args: [target.document_id, ...visible.args],
  };
  const reviews = review ? {
    sql: 'SELECT m.* FROM kw_merges m WHERE m.id=? AND m.head_id=?',
    args: [target.review_id, target.head_id],
  } : !context.guest ? {
    sql: publishedDocumentReviews,
    args: [target.document_id],
  } : {
    sql: 'SELECT m.* FROM kw_merges m WHERE 0',
    args: [],
  };
  const rows = await context.stmt(`WITH RECURSIVE ${commitAncestry},
    document_commits AS (${commits.sql}),
    document_reviews AS (${reviews.sql}),
    submissions AS (
      SELECT m.id, m.head_id, m.auto_promote,
        COALESCE(e.created_at, CASE WHEN m.version=1+(m.state='merged') THEN m.created_at END) AS created_at,
        COALESCE(e.actor_id, m.author_id) AS author_id,
        CASE WHEN e.actor_id IS NULL OR e.actor_id=m.author_id THEN m.author_name
          WHEN e.actor_id=h.author_id THEN h.author_name END AS author_name
      FROM document_reviews m JOIN kw_commits h ON h.id=m.head_id
      LEFT JOIN kw_events e ON e.id=(
        SELECT MIN(event.id) FROM kw_events event
        WHERE event.action IN ('review.submit','merge.propose')
          AND json_extract(event.detail_json,'$.id')=m.id AND json_extract(event.detail_json,'$.head_id')=m.head_id
      )
    ),
    entries(kind,id,created_at,author_id,author_name,body,comment_id,parent_author_name,commit_id,commit_branch_id) AS (
      SELECT 'comment', 'comment:'||c.id, c.created_at, c.author_id, c.author_name, c.body,
        c.id, parent.author_name, NULL, NULL
      FROM kw_comments c LEFT JOIN kw_comments parent ON parent.id=c.parent_id
      WHERE ${comments.where} AND c.quote IS NULL
      UNION ALL
      SELECT CASE WHEN c.branch_id='main' AND c.merge_parent_id IS NOT NULL THEN 'merge' ELSE 'commit' END,
        'commit:'||c.id, c.created_at, c.author_id, c.author_name, c.message, NULL, NULL, c.id, NULL
      FROM document_commits c
      WHERE NOT EXISTS(SELECT 1 FROM submissions s WHERE s.auto_promote=1 AND s.head_id=c.id
        AND s.created_at=c.created_at AND s.author_id=c.author_id)
      UNION ALL
      SELECT 'submission', 'submission:'||s.id, s.created_at, s.author_id, s.author_name,
        CASE WHEN s.auto_promote=1 AND c.created_at=s.created_at AND c.author_id=s.author_id THEN c.message END,
        NULL, NULL, c.id, NULL
      FROM submissions s LEFT JOIN document_commits c ON c.id=s.head_id WHERE s.created_at IS NOT NULL
      UNION ALL
      SELECT 'approval', 'approval:'||a.merge_id||':'||a.actor_id, a.created_at, a.actor_id, a.actor_name,
        NULL, NULL, NULL, NULL, NULL
      FROM document_reviews m JOIN kw_approvals a ON a.merge_id=m.id AND a.head_id=m.head_id
    )
    SELECT kind,id,created_at,author_id,author_name,body,comment_id,parent_author_name,commit_id,
      CASE WHEN kind='merge' THEN 'main' ELSE commit_branch_id END AS commit_branch_id
    FROM entries WHERE ? IS NULL OR created_at < ? OR (created_at=? AND id<?)
    ORDER BY created_at DESC,id DESC LIMIT ?
  `, review ? target.head_id : branch.head_id, ...commits.args, ...reviews.args, ...comments.args,
    before, before, before, beforeId, pageSize + 1).all<KnowledgeActivity>();
  const entries = rows.results.slice(0, pageSize);
  const last = entries.at(-1);
  return {entries, next_cursor: rows.results.length > pageSize && last ? JSON.stringify([last.created_at, last.id]) : null};
}
