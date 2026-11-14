import { Failure } from "../types.ts";
import type { ServiceContext } from './context.ts';
import { type Row } from './model.ts';
export function referenceGuard(context: ServiceContext, key: string, task: Row, references: ReadonlyArray<{
  observation_id: string;
  content_version: number;
}>) {
  if (!references.length) return null;
  return context.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN ? IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(
        SELECT 1 FROM observations o
        JOIN archives ar ON ar.id=o.archive_id AND (ar.deleted=0 OR ?='admin')
        JOIN observation_versions ov ON ov.observation_id=o.id AND ov.version=json_extract(r.value,'$.content_version')
        WHERE o.id=json_extract(r.value,'$.observation_id') AND o.archive_id=?
          AND (o.deleted=0 OR o.author_id=? OR ?='admin')
      )
    ) THEN 1 ELSE 0 END)`, key, task.archive_id, JSON.stringify(references), context.actor.role, task.archive_id, context.actor.id, context.actor.role);
}
export async function validateReferences(context: ServiceContext, task: Row, references: ReadonlyArray<{
  observation_id: string;
  content_version: number;
}>) {
  if (!references.length) return;
  if (!task.archive_id) throw new Failure(400, 'TASK_ARCHIVE_REQUIRED', '未关联档案的任务不能引用观察');
  for (const reference of references) {
    const row = await context.stmt(`SELECT o.id FROM observations o JOIN archives ar ON ar.id=o.archive_id AND (ar.deleted=0 OR ?='admin') JOIN observation_versions ov ON ov.observation_id=o.id AND ov.version=? WHERE o.id=? AND o.archive_id=? AND (o.deleted=0 OR o.author_id=? OR ?='admin')`, context.actor.role, reference.content_version, reference.observation_id, task.archive_id, context.actor.id, context.actor.role).first();
    if (!row) throw new Failure(403, 'REFERENCE_NOT_VISIBLE', '引用的观察不属于关联档案或当前不可见，未保存此次操作');
  }
}
export async function visibleReference(context: ServiceContext, task: Row, reference: {
  observation_id: string;
  content_version: number;
}) {
  if (!task.archive_id) return null;
  const row = await context.stmt(`SELECT o.id observation_id,o.archive_id,ov.version content_version FROM observations o JOIN archives ar ON ar.id=o.archive_id AND (ar.deleted=0 OR ?='admin') JOIN observation_versions ov ON ov.observation_id=o.id AND ov.version=? WHERE o.id=? AND o.archive_id=? AND (o.deleted=0 OR o.author_id=? OR ?='admin')`, context.actor.role, reference.content_version, reference.observation_id, task.archive_id, context.actor.id, context.actor.role).first<{
    observation_id: string;
    archive_id: string;
    content_version: number;
  }>();
  return row ? {
    ...row
  } : null;
}
