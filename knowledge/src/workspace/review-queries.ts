import { KnowledgeError } from "../types.ts";
import type { KnowledgeMerge } from "../../../app/shared/knowledge.ts";
import type { ServiceContext } from './context.ts';
export async function listMergeRequests(context: ServiceContext) {
  if (context.guest) return {
    merges: []
  };
  const rows = await context.stmt("SELECT m.*,b.name AS branch_name,b.head_id AS current_head_id,(SELECT COUNT(*) FROM kw_approvals a WHERE a.merge_id=m.id AND a.head_id=m.head_id) AS approval_count,(SELECT COUNT(*) FROM kw_approvals a WHERE a.merge_id=m.id AND a.head_id=m.head_id AND a.actor_id=?) AS approved_by_me FROM kw_merges m JOIN kw_branches b ON b.id=m.branch_id WHERE b.state<>'closed' AND (b.visibility='members' OR b.owner_id=?) ORDER BY m.updated_at DESC,m.id", context.actor.id, context.actor.id).all<KnowledgeMerge>();
  return {
    merges: rows.results
  };
}
export async function qualifiedMerges(context: ServiceContext) {
  return (await listMergeRequests(context)).merges.filter(m => m.state === 'open' && m.head_id === m.current_head_id && m.approval_count >= 3);
}
export async function getMergeRequest(context: ServiceContext, id: string) {
  const m = (await listMergeRequests(context)).merges.find(m => m.id === id);
  if (!m) throw new KnowledgeError(404, 'NOT_FOUND', '合并请求不存在或不可见');
  return m;
}
