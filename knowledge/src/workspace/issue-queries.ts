import { KnowledgeError } from "../types.ts";
import type { KnowledgeIssue } from "../../../app/shared/knowledge.ts";
import type { ServiceContext } from './context.ts';
import { visibleTag } from './records.ts';

function visibleIssue(context: ServiceContext) {
  return `(category_id IS NULL OR EXISTS(SELECT 1 FROM kw_categories c WHERE c.id=kw_issues.category_id AND ${visibleTag(context, 'c')}))`;
}
export async function listIssues(context: ServiceContext, offset = 0) {
  if (context.guest) return {
    issues: [],
    next_offset: null
  };
  const rows = await context.stmt(`SELECT * FROM kw_issues WHERE ${visibleIssue(context)} ORDER BY updated_at DESC,id LIMIT 41 OFFSET ?`, offset).all<KnowledgeIssue>();
  return {
    issues: rows.results.slice(0, 40),
    next_offset: rows.results.length > 40 ? offset + 40 : null
  };
}
export async function getIssue(context: ServiceContext, id: string) {
  if (context.guest) throw new KnowledgeError(404, 'NOT_FOUND', '议题不存在或不可见');
  const row = await context.stmt(`SELECT * FROM kw_issues WHERE id=? AND ${visibleIssue(context)}`, id).first<KnowledgeIssue>();
  if (!row) throw new KnowledgeError(404, 'NOT_FOUND', '议题不存在');
  return row;
}
