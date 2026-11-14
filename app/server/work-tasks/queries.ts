import { followUpTaskSql } from "../follow-up-tasks.ts";
import { WorkTaskLabels } from "../work-task-labels.ts";
import { taskLabelKey, taskLabelKeys, taskLabelDisplay } from "../../rules/task-labels.ts";
import { taskOverdue } from "../../rules/task-notifications.ts";
import { assertAdmin } from "../credentials.ts";
import { now } from "../types.ts";
import { pushCandidates, pushStage, preferenceMatchesSql, type PushableTaskKind } from "../../rules/task-preferences.ts";
import { TagState, type TagLabel } from "../tag-state.ts";
import { isMemberArchive, archiveDisplayStatus, archivePath } from "../../rules/archive-states.ts";
import { taskDeliveryReady, taskRequiresObservation } from "../../rules/task-delivery.ts";
import { Archives } from "../archives.ts";
import type { ServiceContext } from './context.ts';
import { visibleReference } from './references.ts';
import { getTask, taskRoundStartedSql, ownerRoundObservationSql } from './records.ts';
import { readTaskHistory } from './history.ts';
import { workTaskListInput } from './inputs.ts';
import { type Row } from './model.ts';
export async function listTasks(context: ServiceContext, input: unknown = {}) {
  const a = workTaskListInput.parse(input);
  if (a.scope === 'admin') assertAdmin(context.actor);
  const where = a.state === 'open' ? ["t.status='open'"] : a.state === 'closed' ? ["t.status<>'open'"] : [],
    args: unknown[] = [];
  where.push('(t.archive_id IS NULL OR ar.id IS NOT NULL)');
  if (a.archive_id) {
    where.push('t.archive_id=?');
    args.push(a.archive_id);
  }
  if (a.labels.length) {
    const values = [...new Set(a.labels.flatMap(value => [taskLabelKey(value), taskLabelDisplay(value).toLowerCase()]))];
    where.push('EXISTS(SELECT 1 FROM json_each(t.labels_json) j WHERE lower(trim(j.value)) IN (SELECT value FROM json_each(?)))');
    args.push(JSON.stringify(values));
  }
  if (a.priority) {
    where.push('t.priority=?');
    args.push(a.priority);
  }
  if (a.query) {
    // Literal substring matching before LIMIT; wildcard characters stay literal.
    where.push("(instr(lower(t.title),lower(?))>0 OR instr(lower(t.purpose),lower(?))>0 OR instr(lower(t.delivery),lower(?))>0 OR instr(lower(ar.name),lower(?))>0)");
    args.push(a.query, a.query, a.query, a.query);
  }
  if (a.scope === 'mine') {
    where.push('t.owner_id=?');
    args.push(context.actor.id);
  }
  if (a.scope === 'recommended') {
    where.push(`(${preferenceMatchesSql('?')} AND t.owner_id IS NULL)`);
    args.push(context.actor.id);
  }
  const rows = await context.stmt(`SELECT t.*,${followUpTaskSql} follow_up,${taskRoundStartedSql} round_started_at,${ownerRoundObservationSql} has_owner_round_observation,
      CASE WHEN t.status='open' THEN NULL ELSE COALESCE(
        (SELECT max(e.created_at) FROM work_task_events e WHERE e.task_id=t.id AND e.kind IN ('task.completed','task.cancelled','task.expired','completed','cancelled','expired')),
        t.completed_at
      ) END closed_at,
      (SELECT name FROM members WHERE id=t.owner_id) owner_name,
      (SELECT version FROM members WHERE id=t.owner_id) owner_version,
      (SELECT name FROM members WHERE id=t.initiator_id) initiator_name,
      (SELECT version FROM members WHERE id=t.initiator_id) initiator_version,
      ar.type archive_type,
      ar.name archive_name,
      ar.status archive_status,
      ar.person_role archive_person_role,
      CASE WHEN ar.member_work_paused=1 AND COALESCE(ar.member_status,'可接工作')='可接工作' THEN '暂不接工作' ELSE ar.member_status END archive_member_status,
      ar.closed archive_closed,
      ar.deleted archive_deleted,
      ar.version archive_version,
      ar.updated_at archive_updated_at,
      (SELECT count(*) FROM observations o WHERE o.archive_id=ar.id AND o.deleted=0) archive_observation_count,
      (SELECT substr(v.body,1,240) FROM observations o JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version WHERE o.archive_id=ar.id AND o.deleted=0 ORDER BY o.updated_at DESC,o.id DESC LIMIT 1) archive_latest_observation,
      (SELECT json_group_array(json_object('id',m.id,'name',m.name,'frozen',m.frozen)) FROM archive_bindings b JOIN members m ON m.id=b.member_id WHERE b.archive_id=ar.id AND b.status=ar.status) archive_members_json
      FROM work_tasks t
      LEFT JOIN archives ar ON ar.id=t.archive_id AND (ar.deleted=0 OR ?='admin')
      WHERE ${where.join(' AND ')} ORDER BY t.priority,t.updated_at DESC,t.id LIMIT ? OFFSET ?`, context.actor.role, ...args, a.limit + 1, a.offset).all();
  const next_offset = rows.results.length > a.limit ? a.offset + a.limit : null;
  const tasks = rows.results.slice(0, a.limit) as (Record<string, unknown> & {
    archive_id: string | null;
    archive_members_json?: string | null;
  })[];
  const labelNames = await new WorkTaskLabels(context.env, context.actor, context.source).names(tasks.flatMap(task => JSON.parse(String(task.labels_json ?? '[]')) as string[]));
  const archiveIds = [...new Set(tasks.map(task => task.archive_id).filter((id): id is string => !!id))];
  const tagSummaries = archiveIds.length ? await new TagState(context.env, context.actor).summaries(archiveIds) : new Map<string, {
    tags: TagLabel[];
    total: number;
  }>();
  for (const task of tasks) {
    const labelKeys = taskLabelKeys(JSON.parse(String(task.labels_json ?? '[]')) as string[]);
    task.label_keys = labelKeys;
    task.labels = labelKeys.map(key => labelNames.get(key) ?? taskLabelDisplay(key));
    task.overdue = taskOverdue({
      status: String(task.status),
      deadline_at: String(task.deadline_at)
    }, now());
    task.initiator_name = task.initiator_name ?? '未知发起人';
    const resultRefs = JSON.parse(String(task.result_references_json ?? '[]')) as {
        observation_id: string;
        content_version: number;
      }[],
      visibleResultRefs = [];
    for (const reference of resultRefs) {
      const current = await visibleReference(context, task as unknown as Row, reference);
      if (current) visibleResultRefs.push(current);
    }
    task.result_references = visibleResultRefs;
    task.result_references_restricted = visibleResultRefs.length !== resultRefs.length;
    delete task.result_references_json;
    const subject = {
      type: String(task.archive_type),
      status: String(task.archive_status),
      person_role: task.archive_person_role as 'external' | 'member' | null,
      member_status: task.archive_member_status as '可接工作' | '请假' | '失联' | null,
      closed: !!task.archive_closed,
      deleted: !!task.archive_deleted
    };
    task.requires_observation_reference = taskRequiresObservation(task);
    task.ready_to_submit = taskDeliveryReady(task, task.archive_id ? subject : null, !!task.has_owner_round_observation);
    delete task.has_owner_round_observation;
    if (task.archive_id && task.archive_name) {
      task.archive_preview = {
        id: task.archive_id,
        type: task.archive_type,
        name: task.archive_name,
        status: archiveDisplayStatus(subject),
        personnel_status: subject.status,
        person_role: isMemberArchive(subject) ? 'member' : 'external',
        url: `${context.env.APP_ORIGIN}${archivePath(subject)}?archive=${task.archive_id}`,
        version: task.archive_version,
        updated_at: task.archive_updated_at,
        observation_count: task.archive_observation_count ?? 0,
        latest_observation: task.archive_latest_observation ?? null,
        members: JSON.parse(task.archive_members_json ?? '[]'),
        tag_summary: tagSummaries.get(task.archive_id) ?? {
          tags: [],
          total: 0
        }
      };
    }
    for (const key of ['archive_person_role', 'archive_member_status', 'archive_closed', 'archive_deleted']) delete task[key];
    delete task.archive_members_json;
    delete task.archive_type;
    delete task.archive_name;
    delete task.archive_status;
    delete task.archive_version;
    delete task.archive_updated_at;
    delete task.archive_observation_count;
    delete task.archive_latest_observation;
    delete task.labels_json;
  }
  if (a.scope === 'admin') for (const task of tasks) {
    const candidates = await taskCandidates(context, task as unknown as Row);
    task.candidate_count = candidates.length;
    task.push_stage = pushStage(isPushableTask(context, task as unknown as Row), now());
  }
  return {
    tasks,
    next_offset
  };
}
export async function taskCandidates(context: ServiceContext, task: Row) {
  const rows = await context.stmt(`SELECT m.id,m.name,m.frozen,p.all_work,p.kinds_json FROM members m LEFT JOIN member_work_preferences p ON p.member_id=m.id WHERE m.frozen=0 AND m.identity_kind='human' ORDER BY m.name,m.id`).all<{
    id: string;
    name: string;
    frozen: number;
    all_work: number | null;
    kinds_json: string | null;
  }>();
  return pushCandidates(isPushableTask(context, task), rows.results.map(r => ({
    id: r.id,
    name: r.name,
    frozen: !!r.frozen,
    preference: r.all_work === null ? null : {
      memberId: r.id,
      all: !!r.all_work,
      kinds: JSON.parse(r.kinds_json ?? '[]') as PushableTaskKind[]
    }
  })));
}
export function isPushableTask(context: ServiceContext, task: Row) {
  return {
    id: task.id,
    kind: task.kind,
    open: task.status === 'open',
    ownerId: task.owner_id,
    createdAt: task.created_at
  };
}
export async function getTaskDetail(context: ServiceContext, id: string) {
  const task = await getTask(context, id);
  const archive = task.archive_id ? await new Archives(context.env, context.actor, context.source).get(task.archive_id) : null;
  const resultRefs = JSON.parse(task.result_references_json ?? '[]') as {
      observation_id: string;
      content_version: number;
    }[],
    visibleResultRefs = [];
  for (const reference of resultRefs) {
    const current = await visibleReference(context, task, reference);
    if (current) visibleResultRefs.push(current);
  }
  const initiator = await context.stmt('SELECT name,version FROM members WHERE id=?', task.initiator_id).first<{
    name: string;
    version: number;
  }>();
  const labelKeys = taskLabelKeys(JSON.parse(task.labels_json ?? '[]') as string[]),
    labelNames = await new WorkTaskLabels(context.env, context.actor, context.source).names(labelKeys);
  const safeTask = {
    ...task,
    requires_observation_reference: taskRequiresObservation(task),
    ready_to_submit: taskDeliveryReady(task, archive, !!task.has_owner_round_observation),
    label_keys: labelKeys,
    labels: labelKeys.map(key => labelNames.get(key) ?? taskLabelDisplay(key)),
    overdue: taskOverdue(task, now()),
    initiator_name: initiator?.name ?? '未知发起人',
    initiator_version: initiator && 'version' in initiator ? initiator.version : null,
    result_references: visibleResultRefs,
    result_references_restricted: visibleResultRefs.length !== resultRefs.length
  };
  delete safeTask.has_owner_round_observation;
  delete (safeTask as {
    result_references_json?: string;
    labels_json?: string;
  }).result_references_json;
  delete (safeTask as {
    labels_json?: string;
  }).labels_json;
  const [events, comments] = await Promise.all([readTaskHistory(context, {
    id,
    section: 'events'
  }), readTaskHistory(context, {
    id,
    section: 'comments'
  })]);
  return {
    task: safeTask,
    events: events.items,
    comments: comments.items,
    events_next_cursor: events.next_cursor,
    comments_next_cursor: comments.next_cursor
  };
}
