import { Failure } from "../types.ts";
import { Archives } from "../archives.ts";
import type { ServiceContext } from './context.ts';
import { visibleReference } from './references.ts';
import { getTask } from './records.ts';
import { workTaskHistoryInput } from './inputs.ts';
import { type Row, type CommentRow, type CommentVersionRow } from './model.ts';
export async function presentTaskComments(context: ServiceContext, task: Row, rows: CommentRow[]) {
  if (!rows.length) return [];
  const versionRows = await context.stmt(`SELECT * FROM work_task_comment_versions WHERE comment_id IN (${rows.map(() => '?').join(',')}) ORDER BY comment_id,version`, ...rows.map(r => r.id)).all<CommentVersionRow>();
  const versionsByComment = new Map<string, CommentVersionRow[]>();
  for (const version of versionRows.results) {
    const list = versionsByComment.get(version.comment_id) ?? [];
    list.push(version);
    versionsByComment.set(version.comment_id, list);
  }
  const result = [];
  for (const row of rows) {
    const refs = JSON.parse(row.references_json || '[]') as {
      observation_id: string;
      content_version: number;
    }[];
    const visible = [];
    for (const reference of refs) {
      const current = await visibleReference(context, task, reference);
      if (current) visible.push(current);
    }
    const canSeeDeleted = !row.deleted_at || row.author_id === context.actor.id || context.actor.role === 'admin';
    const history = [];
    for (const version of versionsByComment.get(row.id) ?? []) {
      const versionRefs = JSON.parse(version.references_json || '[]') as {
          observation_id: string;
          content_version: number;
        }[],
        visibleVersionRefs = [];
      for (const reference of versionRefs) {
        const current = await visibleReference(context, task, reference);
        if (current) visibleVersionRefs.push(current);
      }
      history.push({
        version: version.version,
        body: canSeeDeleted ? version.body : null,
        deleted: !!version.deleted_at,
        deleted_at: version.deleted_at,
        references: visibleVersionRefs,
        references_restricted: visibleVersionRefs.length !== versionRefs.length,
        actor_id: version.actor_id,
        source: version.source,
        created_at: version.created_at
      });
    }
    result.push({
      id: row.id,
      task_id: row.task_id,
      author_id: row.author_id,
      author_name: row.author_name,
      body: canSeeDeleted ? row.body : null,
      references: visible,
      references_restricted: visible.length !== refs.length,
      history,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted: !!row.deleted_at,
      deleted_at: row.deleted_at,
      version: row.version
    });
  }
  return result;
}
export async function readTaskHistory(context: ServiceContext, input: unknown) {
  const a = workTaskHistoryInput.parse(input),
    task = await getTask(context, a.id);
  if (task.archive_id) await new Archives(context.env, context.actor, context.source).get(task.archive_id);
  let before = Number.MAX_SAFE_INTEGER;
  if (a.cursor) {
    try {
      const c = JSON.parse(atob(a.cursor));
      if (c.id !== a.id || c.section !== a.section || !Number.isSafeInteger(c.before) || c.before < 1) throw new Error();
      before = c.before;
    } catch {
      throw new Failure(400, 'INVALID_CURSOR', '历史分页位置无效，请从该任务首批重新读取');
    }
  }
  const comments = a.section === 'comments';
  const rows = await context.stmt(comments ? 'SELECT c.rowid position,c.*, (SELECT name FROM members WHERE id=c.author_id) author_name FROM work_task_comments c WHERE c.task_id=? AND c.rowid<? ORDER BY c.rowid DESC LIMIT ?' : 'SELECT e.rowid position,e.id,e.actor_id,(SELECT name FROM members WHERE id=e.actor_id) actor_name,e.source,e.kind,e.before_json,e.after_json,e.reason,e.created_at FROM work_task_events e WHERE e.task_id=? AND e.rowid<? ORDER BY e.rowid DESC LIMIT ?', a.id, before, a.limit + 1).all<Record<string, unknown> & {
    position: number;
  }>();
  const page = rows.results.slice(0, a.limit),
    next_cursor = rows.results.length > a.limit ? btoa(JSON.stringify({
      id: a.id,
      section: a.section,
      before: page.at(-1)!.position
    })) : null;
  const items = comments ? await presentTaskComments(context, task, page as unknown as CommentRow[]) : await Promise.all(page.map(async ({
    position,
    ...event
  }) => {
    const references = [];
    let restricted = false;
    for (const field of ['before_json', 'after_json']) {
      if (!event[field]) continue;
      const snapshot = JSON.parse(String(event[field]));
      for (const reference of snapshot.result_references ?? []) {
        const visible = await visibleReference(context, task, reference);
        if (visible) references.push(visible);else restricted = true;
      }
      delete snapshot.result_references;
      event[field] = JSON.stringify(snapshot);
    }
    return {
      ...event,
      references,
      references_restricted: restricted
    };
  }));
  return {
    section: a.section,
    items,
    next_cursor
  };
}
