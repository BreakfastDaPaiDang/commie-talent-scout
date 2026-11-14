import { command, requestId } from "../commands.ts";
import { Failure, now, uid } from "../types.ts";
import type { ServiceContext } from './context.ts';
import { getTask, assertOpenTask, commentTaskGuard } from './records.ts';
import { validateReferences, referenceGuard, visibleReference } from './references.ts';
import { workTaskCommentCreateInput, workTaskCommentEditInput, workTaskCommentDeleteInput, workTaskCommentRestoreInput } from './inputs.ts';
import { type CommentRow } from './model.ts';
export async function addTaskComment(context: ServiceContext, input: unknown) {
  const a = workTaskCommentCreateInput.parse(input);
  return command(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.comment.create',
    parameters: {
      task_id: a.task_id,
      body: a.body,
      references: a.references
    }
  }, async () => {
    const task = await getTask(context, a.task_id);
    assertOpenTask(context, task);
    await validateReferences(context, task, a.references);
    const id = uid(),
      at = now(),
      key = uid(),
      result = {
        id,
        task_id: task.id,
        author_id: context.actor.id,
        body: a.body,
        references: a.references,
        version: 1,
        changed: true
      };
    const refGuard = referenceGuard(context, key + ':references', task, a.references);
    return {
      result,
      statements: [commentTaskGuard(context, key, task.id), ...(refGuard ? [refGuard] : []), context.stmt('INSERT INTO work_task_comments(id,task_id,author_id,body,references_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', id, task.id, context.actor.id, a.body, JSON.stringify(a.references), at, at), context.stmt('INSERT INTO work_task_comment_versions(comment_id,task_id,version,actor_id,source,body,references_json,created_at) VALUES(?,?,?,?,?,?,?,?)', id, task.id, 1, context.actor.id, context.source, a.body, JSON.stringify(a.references), at), context.event(task.id, 'task.comment_created', {
        comment_id: id
      }, {
        comment_id: id,
        version: 1,
        reference_count: a.references.length
      }), context.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)', key, key + ':references')]
    };
  });
}
export async function editTaskComment(context: ServiceContext, input: unknown) {
  const a = workTaskCommentEditInput.parse(input);
  return command(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.comment.edit',
    parameters: {
      id: a.id,
      expected_version: a.expected_version,
      body: a.body,
      references: a.references
    }
  }, async () => {
    const row = await context.stmt('SELECT * FROM work_task_comments WHERE id=?', a.id).first<CommentRow>();
    if (!row) throw new Failure(404, 'NOT_FOUND', '评论不存在');
    const task = await getTask(context, row.task_id);
    assertOpenTask(context, task);
    if (row.deleted_at) throw new Failure(409, 'COMMENT_DELETED', '已删除评论请先恢复');
    if (context.actor.role !== 'admin' && row.author_id !== context.actor.id) throw new Failure(403, 'COMMENT_AUTHOR_REQUIRED', '只有评论作者或管理员可以修改评论');
    if (row.version !== a.expected_version) throw new Failure(409, 'VERSION_CONFLICT', '评论已被更新，请刷新后重试');
    const oldReferences = JSON.parse(row.references_json || '[]') as {
        observation_id: string;
        content_version: number;
      }[],
      hiddenReferences = [] as {
        observation_id: string;
        content_version: number;
      }[];
    for (const reference of oldReferences) if (!(await visibleReference(context, task, reference))) hiddenReferences.push(reference);
    const requestedReferences = a.references ?? oldReferences.filter(reference => !hiddenReferences.some(hidden => hidden.observation_id === reference.observation_id && hidden.content_version === reference.content_version));
    await validateReferences(context, task, requestedReferences);
    const references = [...new Map([...requestedReferences, ...hiddenReferences].map(reference => [`${reference.observation_id}:${reference.content_version}`, reference])).values()];
    const key = uid(),
      at = now(),
      result = {
        id: row.id,
        task_id: row.task_id,
        body: a.body,
        references: requestedReferences,
        version: row.version + 1,
        changed: true
      };
    const refGuard = referenceGuard(context, key + ':references', task, requestedReferences);
    return {
      result,
      statements: [context.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_task_comments c JOIN work_tasks t ON t.id=c.task_id WHERE c.id=? AND c.version=? AND c.deleted_at IS NULL AND t.status='open' AND (c.author_id=? OR ?='admin')) THEN 1 ELSE 0 END)", key, a.id, a.expected_version, context.actor.id, context.actor.role), ...(refGuard ? [refGuard] : []), context.stmt('UPDATE work_task_comments SET body=?,references_json=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL', a.body, JSON.stringify(references), at, a.id, a.expected_version), context.stmt('INSERT INTO work_task_comment_versions(comment_id,task_id,version,actor_id,source,body,references_json,created_at) VALUES(?,?,?,?,?,?,?,?)', row.id, task.id, row.version + 1, context.actor.id, context.source, a.body, JSON.stringify(references), at), context.event(task.id, 'task.comment_updated', {
        comment_id: row.id,
        version: row.version
      }, {
        comment_id: row.id,
        version: row.version + 1,
        reference_count: references.length
      }), context.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)', key, key + ':references')]
    };
  });
}
export async function deleteTaskComment(context: ServiceContext, input: unknown) {
  const a = workTaskCommentDeleteInput.parse(input);
  return command(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.comment.delete',
    parameters: {
      id: a.id,
      expected_version: a.expected_version
    }
  }, async () => {
    const row = await context.stmt('SELECT * FROM work_task_comments WHERE id=?', a.id).first<CommentRow>();
    if (!row) throw new Failure(404, 'NOT_FOUND', '评论不存在');
    const task = await getTask(context, row.task_id);
    assertOpenTask(context, task);
    if (row.deleted_at) return {
      result: {
        id: row.id,
        task_id: row.task_id,
        deleted: true,
        version: row.version,
        changed: false
      },
      statements: []
    };
    if (row.version !== a.expected_version) throw new Failure(409, 'VERSION_CONFLICT', '评论已被更新，请刷新后重试');
    if (context.actor.role !== 'admin' && row.author_id !== context.actor.id) throw new Failure(403, 'COMMENT_AUTHOR_REQUIRED', '只有评论作者或管理员可以删除评论');
    const key = uid(),
      at = now(),
      result = {
        id: row.id,
        task_id: row.task_id,
        deleted: true,
        deleted_at: at,
        version: row.version + 1,
        changed: true
      };
    return {
      result,
      statements: [context.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_task_comments c JOIN work_tasks t ON t.id=c.task_id WHERE c.id=? AND c.version=? AND c.deleted_at IS NULL AND t.status='open' AND (c.author_id=? OR ?='admin')) THEN 1 ELSE 0 END)", key, a.id, a.expected_version, context.actor.id, context.actor.role), context.stmt('UPDATE work_task_comments SET deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL', at, at, a.id, a.expected_version), context.stmt('INSERT INTO work_task_comment_versions(comment_id,task_id,version,actor_id,source,body,references_json,deleted_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)', row.id, task.id, row.version + 1, context.actor.id, context.source, row.body, row.references_json, at, at), context.event(task.id, 'task.comment_deleted', {
        comment_id: row.id,
        version: row.version
      }, {
        comment_id: row.id,
        version: row.version + 1
      }), context.stmt('DELETE FROM mutation_guards WHERE id=?', key)]
    };
  });
}
export async function restoreTaskComment(context: ServiceContext, input: unknown) {
  const a = workTaskCommentRestoreInput.parse(input);
  return command(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.comment.restore',
    parameters: {
      id: a.id,
      expected_version: a.expected_version
    }
  }, async () => {
    const row = await context.stmt('SELECT * FROM work_task_comments WHERE id=?', a.id).first<CommentRow>();
    if (!row) throw new Failure(404, 'NOT_FOUND', '评论不存在');
    const task = await getTask(context, row.task_id);
    assertOpenTask(context, task);
    if (!row.deleted_at) return {
      result: {
        id: row.id,
        task_id: row.task_id,
        deleted: false,
        version: row.version,
        changed: false
      },
      statements: []
    };
    if (row.version !== a.expected_version) throw new Failure(409, 'VERSION_CONFLICT', '评论已被更新，请刷新后重试');
    if (context.actor.role !== 'admin' && row.author_id !== context.actor.id) throw new Failure(403, 'COMMENT_AUTHOR_REQUIRED', '只有评论作者或管理员可以恢复评论');
    const key = uid(),
      at = now(),
      result = {
        id: row.id,
        task_id: row.task_id,
        deleted: false,
        version: row.version + 1,
        changed: true
      };
    return {
      result,
      statements: [context.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_task_comments c JOIN work_tasks t ON t.id=c.task_id WHERE c.id=? AND c.version=? AND c.deleted_at IS NOT NULL AND t.status='open' AND (c.author_id=? OR ?='admin')) THEN 1 ELSE 0 END)", key, a.id, a.expected_version, context.actor.id, context.actor.role), context.stmt('UPDATE work_task_comments SET deleted_at=NULL,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NOT NULL', at, a.id, a.expected_version), context.stmt('INSERT INTO work_task_comment_versions(comment_id,task_id,version,actor_id,source,body,references_json,deleted_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)', row.id, task.id, row.version + 1, context.actor.id, context.source, row.body, row.references_json, null, at), context.event(task.id, 'task.comment_restored', {
        comment_id: row.id,
        version: row.version
      }, {
        comment_id: row.id,
        version: row.version + 1
      }), context.stmt('DELETE FROM mutation_guards WHERE id=?', key)]
    };
  });
}
