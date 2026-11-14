import { WorkRecommendations } from "../work-recommendations.ts";
import { followUpTaskSql } from "../follow-up-tasks.ts";
import { WorkTaskLabels } from "../work-task-labels.ts";
import { taskPriorityDefaults, reopenableTaskStates } from "../../rules/task-policy.ts";
import { runTaskNotifications } from "../task-notifications.ts";
import { assertAdmin } from "../credentials.ts";
import { command } from "../commands.ts";
import { Failure, now, uid } from "../types.ts";
import type { ServiceContext } from './context.ts';
import { getTask, assertOpenTask } from './records.ts';
import { planAuditRestoration } from './delivery.ts';
import { workTaskCreateInput, workTaskClaimInput, workTaskAssignInput, workTaskReleaseInput, workTaskCancelInput, workTaskExtendInput, workTaskEditInput, workTaskReopenInput } from './inputs.ts';
import { type Row } from './model.ts';
export async function createTask(context: ServiceContext, input: unknown) {
  const a = workTaskCreateInput.parse(input);
  return command(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.create',
    requireAdmin: !!a.handoff && a.handoff.owner_id !== context.actor.id,
    parameters: {
      ...(a.handoff ? {
        handoff: a.handoff
      } : {}),
      follow_up: a.follow_up,
      archive_id: a.archive_id,
      kind: a.kind,
      labels: a.labels,
      priority: a.priority,
      title: a.title,
      purpose: a.purpose,
      delivery: a.delivery,
      deadline_at: a.deadline_at,
      source: a.source,
      period_key: a.period_key
    }
  }, async () => {
    if (a.follow_up && !a.archive_id) throw new Failure(400, 'ARCHIVE_REQUIRED', '跟进任务需要关联档案');
    if (a.deadline_at <= now()) throw new Failure(400, 'DEADLINE_REQUIRED', '开启任务必须有未来期限');
    if (a.kind === 'monthly') throw new Failure(400, 'MONTHLY_GENERATION_REMOVED', '旧月度任务生成已移除，请创建普通跟进任务');
    if (a.archive_id) {
      const archive = await context.stmt('SELECT closed,deleted,status FROM archives WHERE id=?', a.archive_id).first<{
        closed: number;
        deleted: number;
        status: string;
      }>();
      if (!archive) throw new Failure(404, 'ARCHIVE_NOT_FOUND', '关联档案不存在');
      if (archive.deleted) throw new Failure(404, 'ARCHIVE_NOT_FOUND', 'Linked archive is unavailable');
      if (archive.closed) throw new Failure(409, 'ARCHIVE_CLOSED', '关闭档案不能创建工作任务');
    }
    if (a.handoff && (!a.archive_id || a.follow_up || a.kind !== 'custom' || a.source !== 'manual')) throw new Failure(400, 'HANDOFF_INPUT', '对接推荐须创建关联档案的普通任务');
    const handoff = a.handoff ? await new WorkRecommendations(context.env, context.actor, context.source).prepare(a.archive_id!, a.handoff) : null;
    if (handoff?.existing) {
      const existing = await getTask(context, handoff.existing.task_id);
      return {
        result: {
          ...existing,
          changed: false,
          reused: true
        },
        statements: []
      };
    }
    const followupGuard = a.follow_up ? uid() : null;
    if (a.follow_up) {
      const existing = await context.stmt(`SELECT t.* FROM work_tasks t WHERE t.archive_id=? AND t.status='open' AND ${followUpTaskSql} ORDER BY t.created_at,t.id LIMIT 1`, a.archive_id).first<Row>();
      if (existing) return {
        result: {
          ...existing,
          labels: JSON.parse(existing.labels_json),
          changed: false,
          reused: true
        },
        statements: []
      };
    }
    const labelPlan = new WorkTaskLabels(context.env, context.actor, context.source).prepare(a.labels.length ? a.labels : [a.kind]);
    const id = uid(),
      at = now(),
      labels = labelPlan.keys,
      priority = a.priority ?? taskPriorityDefaults[a.kind],
      result = {
        automation_rule: null,
        id,
        archive_id: a.archive_id,
        kind: a.kind,
        labels_json: JSON.stringify(labels),
        labels,
        priority,
        initiator_kind: 'member' as const,
        initiator_id: context.actor.id,
        title: a.title,
        purpose: a.purpose,
        delivery: a.delivery,
        source: a.source,
        status: 'open' as const,
        owner_id: a.handoff?.owner_id ?? null,
        deadline_at: a.deadline_at,
        period_key: a.period_key ?? null,
        created_by: context.actor.id,
        created_at: at,
        updated_at: at,
        version: 1,
        result_kind: null,
        result_text: null,
        result_references_json: '[]',
        completed_at: null,
        closed_reason: null,
        changed: true,
        reused: false
      };
    return {
      result,
      statements: [...(followupGuard ? [context.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archives WHERE id=? AND deleted=0 AND closed=0) AND NOT EXISTS(SELECT 1 FROM work_tasks t WHERE t.archive_id=? AND t.status='open' AND ${followUpTaskSql}) THEN 1 ELSE 0 END)`, followupGuard, a.archive_id, a.archive_id)] : []), ...labelPlan.statements, context.stmt('INSERT INTO work_tasks(id,archive_id,kind,labels_json,priority,initiator_kind,initiator_id,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at,period_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, a.archive_id, a.kind, JSON.stringify(labels), priority, 'member', context.actor.id, a.title, a.purpose, a.delivery, a.source, 'open', a.deadline_at, context.actor.id, at, at, a.period_key ?? null), ...(a.follow_up ? [context.stmt('INSERT INTO work_overview_followups(task_id,archive_id) VALUES(?,?)', id, a.archive_id)] : []), context.event(id, 'task.created', null, result), ...(handoff ? handoff.statements(id) : []), ...(followupGuard ? [context.stmt('DELETE FROM mutation_guards WHERE id=?', followupGuard)] : [])]
    };
  });
}
export async function claimTask(context: ServiceContext, input: unknown) {
  const a = workTaskClaimInput.parse(input);
  try {
    return await command(context.env, context.actor, {
      requestId: a.request_id,
      operation: 'work_task.claim',
      parameters: {
        id: a.id,
        expected_version: a.expected_version
      }
    }, async () => {
      const task = await getTask(context, a.id, a.expected_version);
      assertOpenTask(context, task);
      if (task.owner_id) throw new Failure(409, 'TASK_ALREADY_CLAIMED', '任务已经有人领取');
      const key = uid(),
        at = now(),
        result = {
          id: a.id,
          owner_id: context.actor.id,
          status: 'open',
          version: task.version + 1,
          changed: true
        };
      return {
        result,
        statements: [context.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status=\'open\' AND owner_id IS NULL) THEN 1 ELSE 0 END)', key, a.id, a.expected_version), context.stmt('UPDATE work_tasks SET owner_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=\'open\' AND owner_id IS NULL', context.actor.id, at, a.id, a.expected_version), context.event(a.id, 'task.claimed', {
          owner_id: null,
          version: task.version
        }, {
          owner_id: context.actor.id,
          version: task.version + 1
        }), context.stmt('DELETE FROM mutation_guards WHERE id=?', key)]
      };
    });
  } catch (error) {
    // A stale read and a transaction guard failure are both normal outcomes when
    // two members press Claim together. Re-read only to turn that race into a
    // direct explanation; frozen or expired credentials keep the original auth error.
    if (error instanceof Failure && (error.code === 'VERSION_CONFLICT' || error.code === 'PRECONDITION_CHANGED')) {
      const current = await context.stmt('SELECT status,owner_id FROM work_tasks WHERE id=?', a.id).first<{
        status: string;
        owner_id: string | null;
      }>();
      const auth = await context.stmt(`SELECT m.frozen,m.auth_epoch,c.auth_epoch credential_epoch,c.revoked_at,c.expires_at
          FROM members m JOIN credentials c ON c.member_id=m.id AND c.id=? WHERE m.id=?`, context.actor.credential_id, context.actor.id).first<{
        frozen: number;
        auth_epoch: number;
        credential_epoch: number;
        revoked_at: string | null;
        expires_at: string;
      }>();
      if (current?.status === 'open' && current.owner_id && auth && auth.frozen === 0 && auth.auth_epoch === context.actor.auth_epoch && auth.credential_epoch === context.actor.auth_epoch && !auth.revoked_at && auth.expires_at > now()) {
        throw new Failure(409, 'TASK_ALREADY_CLAIMED', '任务已被其他成员领取，请刷新任务列表');
      }
    }
    throw error;
  }
}
export async function releaseTask(context: ServiceContext, input: unknown) {
  const a = workTaskReleaseInput.parse(input);
  return command(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.release',
    parameters: {
      id: a.id,
      expected_version: a.expected_version,
      deadline_at: a.deadline_at,
      reason: a.reason
    }
  }, async () => {
    const task = await getTask(context, a.id, a.expected_version);
    assertOpenTask(context, task);
    if (task.owner_id !== context.actor.id) throw new Failure(403, 'TASK_OWNER_REQUIRED', '只有当前负责人可以主动交还任务');
    if (a.deadline_at <= now()) throw new Failure(400, 'DEADLINE_REQUIRED', '重新等待接取必须有未来期限');
    const key = uid(),
      at = now(),
      result = {
        id: a.id,
        status: 'open',
        owner_id: null,
        deadline_at: a.deadline_at,
        version: task.version + 1,
        changed: true
      };
    return {
      result,
      statements: [context.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status=\'open\' AND owner_id=?) THEN 1 ELSE 0 END)', key, a.id, a.expected_version, context.actor.id), context.stmt('UPDATE work_tasks SET owner_id=NULL,deadline_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=\'open\' AND owner_id=?', a.deadline_at, at, a.id, a.expected_version, context.actor.id), context.event(a.id, 'task.released', {
        owner_id: task.owner_id,
        deadline_at: task.deadline_at,
        version: task.version
      }, {
        owner_id: null,
        deadline_at: a.deadline_at,
        version: task.version + 1
      }, a.reason), context.stmt('DELETE FROM mutation_guards WHERE id=?', key)]
    };
  });
}
export async function cancelTask(context: ServiceContext, input: unknown) {
  const a = workTaskCancelInput.parse(input);
  return command(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.cancel',
    parameters: {
      id: a.id,
      expected_version: a.expected_version,
      reason: a.reason
    }
  }, async () => {
    const task = await getTask(context, a.id, a.expected_version);
    assertOpenTask(context, task);
    const creatorMayCancel = task.created_by === context.actor.id && !task.owner_id,
      ownerMayCancel = task.owner_id === context.actor.id;
    if (context.actor.role !== 'admin' && !creatorMayCancel && !ownerMayCancel) throw new Failure(403, 'TASK_CANCEL_FORBIDDEN', '只有当前负责人、未接取任务的创建者或管理员可以取消任务');
    const key = uid(),
      at = now(),
      restoration = await planAuditRestoration(context, task, at),
      result = {
        id: a.id,
        status: 'cancelled',
        owner_id: task.owner_id,
        version: task.version + 1,
        changed: true,
        ...restoration.result
      };
    return {
      result,
      statements: [context.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status='open') THEN 1 ELSE 0 END)", key, a.id, a.expected_version), context.stmt("UPDATE work_tasks SET status='cancelled',closed_reason=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='open'", a.reason, at, a.id, a.expected_version), context.event(a.id, 'task.cancelled', {
        status: task.status,
        owner_id: task.owner_id,
        version: task.version
      }, {
        status: 'cancelled',
        owner_id: task.owner_id,
        version: task.version + 1
      }, a.reason), ...restoration.statements, context.stmt('DELETE FROM mutation_guards WHERE id=?', key)]
    };
  });
}
export async function editTask(context: ServiceContext, input: unknown) {
  const a = workTaskEditInput.parse(input),
    admin = context.actor.role === 'admin';
  return command(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.edit',
    parameters: {
      id: a.id,
      expected_version: a.expected_version,
      title: a.title,
      purpose: a.purpose,
      delivery: a.delivery,
      labels: a.labels,
      priority: a.priority,
      deadline_at: a.deadline_at
    },
    requireAdmin: admin
  }, async () => {
    const task = await getTask(context, a.id, a.expected_version);
    assertOpenTask(context, task);
    if (context.actor.role !== 'admin' && task.created_by !== context.actor.id && task.owner_id !== context.actor.id) throw new Failure(403, 'TASK_EDIT_FORBIDDEN', '只有创建者或当前负责人可以维护任务内容');
    if (a.deadline_at !== undefined && Date.parse(a.deadline_at) <= Date.now()) throw new Failure(400, 'DEADLINE_REQUIRED', '截止时间必须仍在未来');
    const labelPlan = a.labels === undefined ? {
      keys: JSON.parse(task.labels_json || '[]') as string[],
      statements: []
    } : new WorkTaskLabels(context.env, context.actor, context.source).prepare(a.labels);
    const labelKeys = labelPlan.keys,
      nextPriority = a.priority ?? task.priority,
      key = uid(),
      at = now(),
      next = {
        title: a.title ?? task.title,
        purpose: a.purpose ?? task.purpose,
        delivery: a.delivery ?? task.delivery,
        deadline_at: a.deadline_at ?? task.deadline_at,
        labels_json: JSON.stringify(labelKeys),
        priority: nextPriority
      },
      changed = next.title !== task.title || next.purpose !== task.purpose || next.delivery !== task.delivery || next.deadline_at !== task.deadline_at || next.labels_json !== task.labels_json || next.priority !== task.priority;
    if (!changed) return {
      result: {
        id: task.id,
        status: task.status,
        version: task.version,
        changed: false
      },
      statements: []
    };
    const result = {
      id: task.id,
      status: task.status,
      title: next.title,
      purpose: next.purpose,
      delivery: next.delivery,
      deadline_at: next.deadline_at,
      labels: labelKeys,
      priority: nextPriority,
      version: task.version + 1,
      changed: true
    };
    return {
      result,
      statements: [...labelPlan.statements, context.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks t WHERE t.id=? AND t.version=? AND t.status='open' AND (t.created_by=? OR t.owner_id=? OR ?='admin')) THEN 1 ELSE 0 END)", key, a.id, a.expected_version, context.actor.id, context.actor.id, context.actor.role), context.stmt('UPDATE work_tasks SET title=?,purpose=?,delivery=?,deadline_at=?,labels_json=?,priority=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=\'open\'', next.title, next.purpose, next.delivery, next.deadline_at, next.labels_json, next.priority, at, a.id, a.expected_version), context.event(a.id, 'task.edited', {
        title: task.title,
        purpose: task.purpose,
        delivery: task.delivery,
        deadline_at: task.deadline_at,
        labels: JSON.parse(task.labels_json || '[]'),
        priority: task.priority,
        version: task.version
      }, result), context.stmt('DELETE FROM mutation_guards WHERE id=?', key)]
    };
  });
}
export async function extendTask(context: ServiceContext, input: unknown) {
  const a = workTaskExtendInput.parse(input);
  return command(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.extend',
    parameters: {
      id: a.id,
      expected_version: a.expected_version,
      deadline_at: a.deadline_at,
      reason: a.reason
    }
  }, async () => {
    const task = await getTask(context, a.id, a.expected_version);
    assertOpenTask(context, task);
    if (task.owner_id !== context.actor.id) throw new Failure(403, 'TASK_OWNER_REQUIRED', '只有当前负责人可以延期任务');
    if (Date.parse(a.deadline_at) <= Date.now() || Date.parse(a.deadline_at) <= Date.parse(task.deadline_at)) throw new Failure(400, 'DEADLINE_REQUIRED', '新的截止时间必须晚于原期限并且仍在未来');
    const key = uid(),
      at = now(),
      result = {
        id: task.id,
        status: 'open',
        deadline_at: a.deadline_at,
        version: task.version + 1,
        changed: true
      };
    return {
      result,
      statements: [context.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status='open' AND owner_id=?) THEN 1 ELSE 0 END)", key, a.id, a.expected_version, context.actor.id), context.stmt("UPDATE work_tasks SET deadline_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='open' AND owner_id=?", a.deadline_at, at, a.id, a.expected_version, context.actor.id), context.event(a.id, 'task.deadline_changed', {
        deadline_at: task.deadline_at,
        version: task.version
      }, {
        deadline_at: a.deadline_at,
        version: task.version + 1
      }, a.reason), context.stmt('DELETE FROM mutation_guards WHERE id=?', key)]
    };
  });
}
export async function reopenTask(context: ServiceContext, input: unknown) {
  const a = workTaskReopenInput.parse(input),
    admin = context.actor.role === 'admin';
  return command(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.reopen',
    parameters: {
      id: a.id,
      expected_version: a.expected_version,
      deadline_at: a.deadline_at,
      owner_mode: a.owner_mode,
      reason: a.reason
    },
    requireAdmin: admin && a.owner_mode === 'unassigned'
  }, async () => {
    const task = await getTask(context, a.id, a.expected_version);
    if (!(reopenableTaskStates as readonly string[]).includes(task.status)) throw new Failure(409, 'TASK_NOT_REOPENABLE', '只有已关闭的任务可以重新开启');
    if (task.archive_id) {
      const archive = await context.stmt('SELECT closed,deleted FROM archives WHERE id=?', task.archive_id).first<{
        closed: number;
        deleted: number;
      }>();
      if (!archive || archive.deleted) throw new Failure(404, 'ARCHIVE_NOT_FOUND', '关联档案不存在');
      if (archive.closed) throw new Failure(409, 'ARCHIVE_CLOSED', '请先重新开启关联档案');
    }
    if (Date.parse(a.deadline_at) <= Date.now()) throw new Failure(400, 'DEADLINE_REQUIRED', '重新开启必须给出未来截止时间');
    if (a.owner_mode === 'keep' && context.actor.role !== 'admin' && task.owner_id !== context.actor.id) throw new Failure(403, 'TASK_OWNER_REQUIRED', '只有原负责人可以保留负责人身份重新开启');
    if (a.owner_mode === 'keep' && context.actor.role === 'admin' && task.owner_id !== context.actor.id) throw new Failure(403, 'TASK_OWNER_REQUIRED', '管理员为他人重新开启时应明确退回待领取');
    if (a.owner_mode === 'unassigned' && context.actor.role !== 'admin') throw new Failure(403, 'ADMIN_REQUIRED', '只有管理员可以将异常任务退回待领取');
    const nextOwner = a.owner_mode === 'keep' ? task.owner_id : null,
      key = uid(),
      at = now(),
      result = {
        id: task.id,
        status: 'open',
        owner_id: nextOwner,
        deadline_at: a.deadline_at,
        version: task.version + 1,
        changed: true,
        previous_result: task.result_kind ? {
          result_kind: task.result_kind,
          result_text: task.result_text,
          completed_at: task.completed_at
        } : null
      };
    return {
      result,
      statements: [context.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status IN ('completed','expired','cancelled') AND ((?='keep' AND owner_id=?) OR (?='unassigned' AND ?='admin'))) THEN 1 ELSE 0 END)", key, a.id, a.expected_version, a.owner_mode, context.actor.id, a.owner_mode, context.actor.role), context.stmt("UPDATE work_tasks SET status='open',owner_id=?,deadline_at=?,result_kind=NULL,result_text=NULL,result_references_json='[]',completed_at=NULL,closed_reason=NULL,updated_at=?,version=version+1 WHERE id=? AND version=? AND status IN ('completed','expired','cancelled')", nextOwner, a.deadline_at, at, a.id, a.expected_version), context.event(a.id, 'task.reopened', {
        status: task.status,
        owner_id: task.owner_id,
        deadline_at: task.deadline_at,
        result_kind: task.result_kind,
        result_text: task.result_text,
        result_references: JSON.parse(task.result_references_json ?? '[]'),
        result_reference_count: JSON.parse(task.result_references_json ?? '[]').length,
        completed_at: task.completed_at,
        closed_reason: task.closed_reason,
        version: task.version
      }, {
        status: 'open',
        owner_id: nextOwner,
        deadline_at: a.deadline_at,
        version: task.version + 1
      }, a.reason), context.stmt('DELETE FROM mutation_guards WHERE id=?', key)]
    };
  });
}
export async function assignTask(context: ServiceContext, input: unknown) {
  assertAdmin(context.actor);
  const a = workTaskAssignInput.parse(input);
  return command(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.assign',
    parameters: {
      id: a.id,
      member_id: a.member_id,
      expected_version: a.expected_version,
      reason: a.reason
    },
    requireAdmin: true
  }, async () => {
    const task = await getTask(context, a.id, a.expected_version);
    assertOpenTask(context, task);
    const member = await context.stmt("SELECT id,frozen FROM members WHERE id=?", a.member_id).first<{
      id: string;
      frozen: number;
    }>();
    if (!member || member.frozen) throw new Failure(409, 'MEMBER_NOT_ELIGIBLE', '只能指派给未冻结的成员');
    const key = uid(),
      at = now(),
      result = {
        id: a.id,
        owner_id: a.member_id,
        status: 'open',
        version: task.version + 1,
        changed: true,
        assigned: true
      };
    return {
      result,
      statements: [context.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status=\'open\') THEN 1 ELSE 0 END)', key, a.id, a.expected_version), context.stmt('UPDATE work_tasks SET owner_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=\'open\'', a.member_id, at, a.id, a.expected_version), context.event(a.id, 'task.assigned', {
        owner_id: task.owner_id,
        version: task.version
      }, {
        owner_id: a.member_id,
        version: task.version + 1
      }, a.reason), context.stmt('DELETE FROM mutation_guards WHERE id=?', key)]
    };
  });
}
export async function expireTasks(context: ServiceContext, at = now()) {
  return runTaskNotifications(context.env, 'overdue', at);
}
export async function pushDueTasks(context: ServiceContext, at = now()) {
  return runTaskNotifications(context.env, 'due', at);
}
