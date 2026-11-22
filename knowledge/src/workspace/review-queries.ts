import { KnowledgeError } from "../types.ts";
import type { KnowledgeMerge, KnowledgeReviewDocument } from "../../../app/shared/knowledge.ts";
import type { ServiceContext } from './context.ts';
import { changedDocument, versionPersonalScopeName, versionScopes, versionTags, visibleTag } from './records.ts';

const approvalCount = '(SELECT COUNT(*) FROM kw_approvals a WHERE a.merge_id=m.id AND a.head_id=m.head_id)';
// Older writers can still create a proposal between the migration and the code rollout.
export const reviewExpiresAt = "COALESCE(m.expires_at, strftime('%Y-%m-%dT%H:%M:%fZ',m.updated_at,'+7 days'))";
export const reviewVisible = `(${reviewExpiresAt} > ? OR ${approvalCount} >= 3)`;
export const singleDocumentBranch = `(SELECT COUNT(*) FROM kw_items i JOIN kw_versions v ON v.id=i.version_id
  WHERE i.branch_id=b.id AND ${changedDocument})=1`;
export const reviewSourceMatches = `EXISTS(SELECT 1 FROM kw_items reviewed
  WHERE reviewed.branch_id=m.branch_id AND reviewed.document_id=s.document_id AND reviewed.version_id=s.source_version_id)`;
export const matchingReviewSubmission = `FROM kw_review_sources s JOIN kw_merges m ON m.id=s.merge_id JOIN kw_branches b ON b.id=m.branch_id
  WHERE s.source_branch_id=? AND s.document_id=? AND s.source_version_id=? AND ${reviewSourceMatches}
    AND (m.state='merged' OR (m.state='open' AND m.head_id=b.head_id AND ${singleDocumentBranch} AND ${reviewVisible}))`;

export async function listMergeRequests(context: ServiceContext, {at = context.clock(), id, search = ''}: {at?: string; id?: string; search?: string} = {}) {
  const actor = context.actor;
  if ('kind' in actor) return { merges: [] };
  const pattern = '%' + search.replace(/[!%_]/g, '!$&') + '%';
  const match = search ? `,(m.title LIKE ? ESCAPE '!' OR m.reason LIKE ? ESCAPE '!' OR EXISTS(
      SELECT 1 FROM kw_items i JOIN kw_versions v ON v.id=i.version_id
      WHERE m.state='open' AND m.head_id=b.head_id AND i.branch_id=b.id AND ${changedDocument}
        AND (v.title LIKE ? ESCAPE '!' OR v.body LIKE ? ESCAPE '!' OR EXISTS(
          SELECT 1 FROM kw_document_tags t JOIN kw_categories c ON c.id=t.category_id
          WHERE t.version_id=v.id AND ${visibleTag(context, 'c')} AND c.name LIKE ? ESCAPE '!')))) AS matches_search` : '';
  const searchArgs = search ? [pattern, pattern, pattern, pattern, pattern] : [];
  const rows = await context.stmt(`SELECT m.*,b.name AS branch_name,b.head_id AS current_head_id,
    CASE WHEN m.state='open' THEN ${reviewExpiresAt} ELSE m.expires_at END AS deadline,
    (SELECT json_group_array(json_object('id', a.actor_id, 'name', a.actor_name, 'created_at', a.created_at) ORDER BY a.created_at, a.actor_id)
      FROM kw_approvals a WHERE a.merge_id=m.id AND a.head_id=m.head_id) AS approvers_json,
    EXISTS(SELECT 1 FROM kw_approvals a WHERE a.merge_id=m.id AND a.head_id=m.head_id
      AND (a.actor_id=? OR a.membership_id=?)) AS approved_by_me,
    (SELECT json_group_array(json_object(
      'document_id', i.document_id, 'title', v.title, 'deleted', v.deleted,
      'tags', json(${versionTags(context)}), 'scopes', json(${versionScopes}), 'personal_scope_name', ${versionPersonalScopeName}
    ) ORDER BY i.document_id)
    FROM kw_items i JOIN kw_versions v ON v.id=i.version_id
    WHERE m.state='open' AND m.head_id=b.head_id AND i.branch_id=b.id AND ${changedDocument}) AS changes_json${match}
    FROM kw_merges m JOIN kw_branches b ON b.id=m.branch_id
    WHERE b.state<>'closed' AND (b.visibility='members' OR b.owner_id=?) AND (? IS NULL OR m.id=?)
    ORDER BY m.updated_at DESC,m.id`, actor.id, actor.membership_id, ...searchArgs, actor.id, id ?? null, id ?? null).all<KnowledgeMerge & {approvers_json: string;changes_json: string;deadline:string|null}>();
  const merges = rows.results.map(({changes_json, approvers_json, deadline, ...m}) => {
    const approvers = JSON.parse(approvers_json) as NonNullable<KnowledgeMerge['approvers']>;
    const voting_closed = m.state === 'open' && !!deadline && deadline <= at;
    const changes = (JSON.parse(changes_json) as KnowledgeReviewDocument[]).map(change => ({...change, deleted: !!change.deleted}));
    return {...m, approvers, approval_count: approvers.length, expires_at: deadline, voting_closed, expired: voting_closed && approvers.length < 3, changes};
  });
  return { merges };
}

export async function qualifiedMerges(context: ServiceContext, at = context.clock()) {
  return (await listMergeRequests(context, {at})).merges.filter(m => m.state === 'open' && m.head_id === m.current_head_id && m.changes.length === 1 && m.approval_count >= 3);
}

export async function qualifiedAlternatives(context: ServiceContext, merge: KnowledgeMerge, at: string) {
  if (merge.changes?.length !== 1) return [];
  const documentId = merge.changes[0].document_id;
  return (await qualifiedMerges(context, at)).filter(candidate =>
    candidate.changes[0].document_id === documentId);
}

export async function hasReviewAlternative(context: ServiceContext, mergeId: string, documentId: string, at: string) {
  return !!await context.stmt(`SELECT 1 FROM kw_merges m JOIN kw_branches b ON b.id=m.branch_id
    JOIN kw_items i ON i.branch_id=b.id JOIN kw_versions v ON v.id=i.version_id
    WHERE m.id<>? AND m.state='open' AND b.state='open' AND b.visibility='members' AND m.head_id=b.head_id
      AND i.document_id=? AND ${changedDocument} AND ${singleDocumentBranch} AND ${reviewVisible} LIMIT 1`,
    mergeId, documentId, at).first();
}

export async function getMergeRequest(context: ServiceContext, id: string, at = context.clock()) {
  const [m] = (await listMergeRequests(context, {at, id})).merges;
  if (!m) throw new KnowledgeError(404, 'NOT_FOUND', '合并请求不存在或不可见');
  return m;
}
