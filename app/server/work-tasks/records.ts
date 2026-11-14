import { followUpTaskSql } from "../follow-up-tasks.ts";
import { Failure } from "../types.ts";
import type { ServiceContext } from './context.ts';
import { type Row } from './model.ts';
export
// Shared by list and detail; only the current owner's newly created, live observations count.
const taskRoundStartedSql = "COALESCE((SELECT MAX(e.created_at) FROM work_task_events e WHERE e.task_id=t.id AND e.kind='task.reopened'),t.created_at)";
export const ownerRoundObservationSql = `EXISTS(SELECT 1 FROM observations o WHERE o.archive_id=t.archive_id AND o.author_id=t.owner_id AND o.deleted=0 AND o.created_at>=${taskRoundStartedSql})`;
export async function getTask(context: ServiceContext, id: string, version?: number) {
  const row = await context.stmt(`SELECT t.*,${followUpTaskSql} follow_up,${taskRoundStartedSql} round_started_at,${ownerRoundObservationSql} has_owner_round_observation FROM work_tasks t WHERE t.id=?`, id).first<Row>();
  if (!row) throw new Failure(404, 'NOT_FOUND', '工作任务不存在');
  if (version !== undefined && row.version !== version) throw new Failure(409, 'VERSION_CONFLICT', '工作任务已被更新，请刷新后重试');
  return row;
}
export function assertOpenTask(context: ServiceContext, task: Row) {
  if (task.status !== 'open') throw new Failure(409, 'TASK_NOT_OPEN', '只可操作开放中的任务');
}
export function commentTaskGuard(context: ServiceContext, key: string, taskId: string, openOnly = true) {
  return context.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? ${openOnly ? "AND status='open'" : ''}) THEN 1 ELSE 0 END)`, key, taskId);
}
