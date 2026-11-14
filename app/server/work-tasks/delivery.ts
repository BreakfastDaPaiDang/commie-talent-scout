import { z } from 'zod';
import { command } from "../commands.ts";
import { Failure, now, uid } from "../types.ts";
import { TagState } from "../tag-state.ts";
import { isMemberArchive } from "../../rules/archive-states.ts";
import { taskRequiresObservation, observationRequiredMessage, personnelDeliveryKind, personnelDeliveryResults, isPersonnelDeliveryResult } from "../../rules/task-delivery.ts";
import { Archives } from "../archives.ts";
import { auditCancellationTarget, planArchiveEffects, preparePersonnelTask } from "../../rules/archive-lifecycle.ts";
import type { ServiceContext } from './context.ts';
import { getTask, assertOpenTask } from './records.ts';
import { validateReferences, referenceGuard } from './references.ts';
import { workTaskCompleteInput, workTaskReferInput, workTaskMembershipInput } from './inputs.ts';
import { type Row } from './model.ts';
export async function completeTask(context: ServiceContext, input: unknown) {
  const a = workTaskCompleteInput.parse(input);
  return command<Record<string, unknown>>(context.env, context.actor, {
    requestId: a.request_id,
    operation: 'work_task.complete',
    parameters: {
      id: a.id,
      expected_version: a.expected_version,
      result_kind: a.result_kind,
      result_text: a.result_text,
      references: a.references,
      next_contact_at: a.next_contact_at
    }
  }, async () => {
    const task = await getTask(context, a.id, a.expected_version);
    assertOpenTask(context, task);
    if (task.owner_id !== context.actor.id) throw new Failure(403, 'TASK_OWNER_REQUIRED', '只有当前负责人可以提交完成结果');
    if (taskRequiresObservation(task) && !a.references.length) throw new Failure(400, 'OBSERVATION_REFERENCE_REQUIRED', observationRequiredMessage);
    await validateReferences(context, task, a.references);
    const needsFresh = taskRequiresObservation(task),
      round = task.round_started_at ?? task.created_at;
    const freshSql = "SELECT 1 FROM observations o WHERE o.id IN (SELECT json_extract(value,'$.observation_id') FROM json_each(?)) AND o.archive_id=? AND o.deleted=0 AND o.created_at>=?";
    if (needsFresh && !(await context.stmt(freshSql, JSON.stringify(a.references), task.archive_id, round).first())) throw new Failure(400, 'CURRENT_ROUND_OBSERVATION_REQUIRED', observationRequiredMessage);
    const freshnessKey = uid(),
      freshness = needsFresh ? [context.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(${freshSql}) THEN 1 ELSE 0 END)`, freshnessKey, JSON.stringify(a.references), task.archive_id, round), context.stmt('DELETE FROM mutation_guards WHERE id=?', freshnessKey)] : [];
    if (needsFresh && a.result_kind === 'unable_to_contact') {
      const at = now(),
        key = uid();
      if (!a.next_contact_at || a.next_contact_at <= at) throw new Failure(400, 'NEXT_CONTACT_REQUIRED', '请选择下一次联系时间，任务继续保持开启');
      const refGuard = referenceGuard(context, key + ':references', task, a.references);
      return {
        result: {
          id: a.id,
          status: 'open',
          deadline_at: a.next_contact_at,
          version: task.version + 1,
          changed: true
        },
        statements: [context.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status='open' AND owner_id=?) THEN 1 ELSE 0 END)", key, a.id, a.expected_version, context.actor.id), ...freshness, ...(refGuard ? [refGuard] : []), context.stmt("UPDATE work_tasks SET deadline_at=?,updated_at=?,version=version+1 WHERE id=?", a.next_contact_at, at, a.id), context.event(a.id, 'task.contact_attempted', {
          deadline_at: task.deadline_at
        }, {
          status: 'open',
          deadline_at: a.next_contact_at,
          result_kind: a.result_kind,
          result_text: a.result_text,
          result_references: a.references
        }, a.result_text), context.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)', key, key + ':references')]
      };
    }
    const key = uid(),
      at = now(),
      progress = await planPersonnelDelivery(context, task, a.result_kind, at),
      result = {
        id: a.id,
        status: 'completed',
        result_kind: a.result_kind,
        result_text: a.result_text,
        references: a.references,
        version: task.version + 1,
        changed: true,
        ...progress.result
      },
      refGuard = referenceGuard(context, key + ':references', task, a.references);
    return {
      result,
      statements: [context.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status='open' AND owner_id=?) THEN 1 ELSE 0 END)", key, a.id, a.expected_version, context.actor.id), ...freshness, ...(refGuard ? [refGuard] : []), ...progress.statements, context.stmt("UPDATE work_tasks SET status='completed',result_kind=?,result_text=?,result_references_json=?,completed_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='open' AND owner_id=?", a.result_kind, a.result_text, JSON.stringify(a.references), at, at, a.id, a.expected_version, context.actor.id), context.event(a.id, 'task.completed', {
        status: task.status,
        owner_id: task.owner_id,
        version: task.version
      }, {
        status: 'completed',
        owner_id: task.owner_id,
        result_kind: a.result_kind,
        result_text: a.result_text,
        reference_count: a.references.length,
        result_references: a.references,
        version: task.version + 1,
        ...progress.result
      }), context.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)', key, key + ':references')]
    };
  });
}
export async function planPersonnelDelivery(context: ServiceContext, task: Row, resultKind: string, at: string) {
  const unchanged = {
    result: {},
    statements: [] as D1PreparedStatement[]
  };
  if (!isPersonnelDeliveryResult(resultKind)) return unchanged;
  const rule = personnelDeliveryResults[resultKind];
  if (personnelDeliveryKind(task) !== rule.kind) throw new Failure(400, 'INVALID_PERSONNEL_RESULT', '该结论只适用于对应的自动人事任务，不能通过标签或普通任务改变身份');
  const archives = new Archives(context.env, context.actor, context.source),
    old = await archives.get(task.archive_id!, undefined, true),
    key = uid();
  if (old.type !== 'person') throw new Failure(409, 'PERSONNEL_STAGE_CHANGED', '关联档案不是人物档案，请核对后重新交付');
  const advanced = old.status === rule.to || isMemberArchive(old);
  if (!advanced && old.status !== rule.from) throw new Failure(409, 'PERSONNEL_STAGE_CHANGED', '档案已离开此人事阶段，请核对当前状态后重新交付');
  // A reopened earlier task must not take over a later referral at the same stage.
  if (!advanced) {
    const event = await context.stmt("SELECT after_json FROM archive_events WHERE archive_id=? AND kind='archive.state_changed' ORDER BY seq DESC LIMIT 1", old.id).first<{
      after_json: string;
    }>();
    const current = event ? JSON.parse(event.after_json) : null;
    if (current?.status === rule.from && current.task_id && current.task_id !== task.id) throw new Failure(409, 'PERSONNEL_STAGE_CHANGED', '该任务不属于当前人事轮次，请使用当前关联任务');
  }
  const statements = [archives.guard(old.id, old.version, key)];
  const stageTask = !advanced ? await preparePersonnelTask(context.stmt, old.id, rule.to, new Date(Date.parse(at) + 7 * 86400000).toISOString()) : null;
  if (!advanced) statements.push(...planArchiveEffects({
    old,
    status: rule.to,
    memberIds: [],
    reopen: false,
    stageTask,
    at,
    actorId: context.actor.id,
    source: context.source,
    members: [],
    bindings: [],
    tags: new TagState(context.env, context.actor),
    stmt: context.stmt,
    event: archives.event.bind(archives)
  }));
  statements.push(context.stmt('DELETE FROM mutation_guards WHERE id=?', key));
  return {
    result: {
      archive_id: old.id,
      archive_status: advanced ? old.status : rule.to,
      archive_version: old.version + (advanced ? 0 : 1),
      archive_advanced: !advanced,
      ...(!advanced && rule.to === '已入伙' ? {
        membership_joined: true
      } : {}),
      next_task_id: stageTask?.id ?? null
    },
    statements
  };
}
export async function planAuditRestoration(context: ServiceContext, task: Row, at: string) {
  const unchanged = {
    result: {},
    statements: [] as D1PreparedStatement[]
  };
  if (!task.archive_id || task.kind !== 'audit' || task.source !== 'rule') return unchanged;
  const current = await context.stmt('SELECT status,closed,deleted FROM archives WHERE id=?', task.archive_id).first<{
    status: string;
    closed: number;
    deleted: number;
  }>();
  if (!current || current.closed || current.deleted || current.status !== '人事审核') return unchanged;
  const archives = new Archives(context.env, context.actor, context.source),
    old = await archives.get(task.archive_id);
  const event = await context.stmt("SELECT before_json,after_json FROM archive_events WHERE archive_id=? AND kind='archive.state_changed' ORDER BY seq DESC LIMIT 1", old.id).first<{
    before_json: string | null;
    after_json: string | null;
  }>();
  const status = auditCancellationTarget(task, old, event ? {
    before: event.before_json ? JSON.parse(event.before_json) : null,
    after: event.after_json ? JSON.parse(event.after_json) : null
  } : null);
  if (!status) return unchanged;
  const members = old.bindings[status] ?? [],
    key = uid(),
    bindings = members.map(member => context.stmt('INSERT INTO archive_bindings(archive_id,status,member_id) VALUES(?,?,?)', old.id, status, member.id));
  return {
    result: {
      archive_id: old.id,
      archive_status: status,
      archive_version: old.version + 1
    },
    statements: [archives.guard(old.id, old.version, key), ...planArchiveEffects({
      old,
      status,
      memberIds: members.map(member => member.id).sort(),
      reopen: false,
      at,
      actorId: context.actor.id,
      source: context.source,
      members,
      bindings,
      tags: new TagState(context.env, context.actor),
      stmt: context.stmt,
      event: archives.event.bind(archives)
    }), context.stmt('DELETE FROM mutation_guards WHERE id=?', key)]
  };
}
export async function transitionPersonnel(context: ServiceContext, a: z.infer<typeof workTaskReferInput>, status: '人事审核' | '已加入待对接') {
  const service = new Archives(context.env, context.actor, context.source);
  // setState owns request replay, version checks, state, task creation and history in one transaction.
  // No pre-read can turn a successful retry into a stale-version failure.
  const result = await service.setState({
    id: a.archive_id,
    expected_version: a.expected_version,
    status,
    member_ids: [],
    deadline_at: a.deadline_at,
    request_id: a.request_id
  });
  return {
    ...result,
    id: result.task_id ?? result.id,
    task_id: result.task_id ?? null,
    archive_id: a.archive_id,
    archive_status: status,
    archive_version: result.version,
    status: result.task_id ? 'open' : null,
    reused: result.reused ?? !result.changed
  };
}
export async function referArchive(context: ServiceContext, input: unknown) {
  return transitionPersonnel(context, workTaskReferInput.parse(input), '人事审核');
}
export async function confirmMembership(context: ServiceContext, input: unknown) {
  return transitionPersonnel(context, workTaskMembershipInput.parse(input), '已加入待对接');
}
