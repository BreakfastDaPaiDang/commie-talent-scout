import { handoffInput } from "../work-recommendations.ts";
import { taskKinds, taskPriorities } from "../../rules/task-policy.ts";
import { z } from 'zod';
import { expectedVersion, requestId } from "../commands.ts";
export const workTaskCommentReferenceInput = z.object({
  observation_id: z.uuid(),
  content_version: z.number().int().min(1)
}).strict();
export const monthlyKeyInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '月份必须使用 YYYY-MM 格式');
export const workTaskCreateInput = z.object({
  handoff: handoffInput.optional(),
  follow_up: z.boolean().default(false),
  archive_id: z.uuid().nullable().default(null),
  kind: z.enum(taskKinds).default('custom'),
  labels: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
  priority: z.enum(taskPriorities).optional(),
  title: z.string().trim().min(1).max(160),
  purpose: z.string().trim().min(1).max(4000),
  delivery: z.string().trim().min(1).max(4000),
  deadline_at: z.string().datetime(),
  source: z.enum(['manual', 'rule']).default('manual'),
  period_key: monthlyKeyInput.optional(),
  request_id: requestId
}).strict();
export const workTaskClaimInput = z.object({
  id: z.uuid(),
  expected_version: expectedVersion,
  request_id: requestId
}).strict();
export const workTaskAssignInput = z.object({
  id: z.uuid(),
  member_id: z.uuid(),
  expected_version: expectedVersion,
  reason: z.string().trim().min(1).max(500),
  request_id: requestId
}).strict();
export const workTaskCompleteInput = z.object({
  id: z.uuid(),
  expected_version: expectedVersion,
  result_kind: z.enum(['completed', 'continue', 'not_suitable', 'unable_to_contact', 'joined', 'discarded', 'audit_passed', 'onboarding_completed']),
  result_text: z.string().trim().min(1).max(5000),
  next_contact_at: z.string().datetime().optional(),
  references: z.array(workTaskCommentReferenceInput).max(20).default([]),
  request_id: requestId
}).strict();
export const workTaskReleaseInput = z.object({
  id: z.uuid(),
  expected_version: expectedVersion,
  deadline_at: z.string().datetime(),
  reason: z.string().trim().max(500).default('主动交还，重新等待接取'),
  request_id: requestId
}).strict();
export const workTaskCancelInput = z.object({
  id: z.uuid(),
  expected_version: expectedVersion,
  reason: z.string().trim().min(1).max(500),
  request_id: requestId
}).strict();
export const workTaskExtendInput = z.object({
  id: z.uuid(),
  expected_version: expectedVersion,
  deadline_at: z.string().datetime(),
  reason: z.string().trim().max(500).default('延期任务期限'),
  request_id: requestId
}).strict();
export const workTaskEditInput = z.object({
  id: z.uuid(),
  expected_version: expectedVersion,
  title: z.string().trim().min(1).max(160).optional(),
  purpose: z.string().trim().min(1).max(4000).optional(),
  delivery: z.string().trim().min(1).max(4000).optional(),
  labels: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  priority: z.enum(taskPriorities).optional(),
  deadline_at: z.string().datetime().optional(),
  request_id: requestId
}).strict().refine(a => a.title !== undefined || a.purpose !== undefined || a.delivery !== undefined || a.labels !== undefined || a.priority !== undefined || a.deadline_at !== undefined, {
  message: '至少需要调整一项任务内容'
});
export const workTaskReopenInput = z.object({
  id: z.uuid(),
  expected_version: expectedVersion,
  deadline_at: z.string().datetime(),
  owner_mode: z.enum(['keep', 'unassigned']).default('keep'),
  reason: z.string().trim().max(500).default('重新开启任务'),
  request_id: requestId
}).strict();
export const workTaskCommentCreateInput = z.object({
  task_id: z.uuid(),
  body: z.string().trim().min(1).max(5000),
  references: z.array(workTaskCommentReferenceInput).max(20).default([]),
  request_id: requestId
}).strict();
export const workTaskCommentEditInput = z.object({
  id: z.uuid(),
  expected_version: expectedVersion,
  body: z.string().trim().min(1).max(5000),
  references: z.array(workTaskCommentReferenceInput).max(20).optional(),
  request_id: requestId
}).strict();
export const workTaskCommentDeleteInput = z.object({
  id: z.uuid(),
  expected_version: expectedVersion,
  request_id: requestId
}).strict();
export const workTaskCommentRestoreInput = z.object({
  id: z.uuid(),
  expected_version: expectedVersion,
  request_id: requestId
}).strict();
export const workTaskReferInput = z.object({
  archive_id: z.uuid(),
  expected_version: expectedVersion,
  deadline_at: z.string().datetime(),
  request_id: requestId
}).strict();
export const workTaskMembershipInput = z.object({
  archive_id: z.uuid(),
  expected_version: expectedVersion,
  deadline_at: z.string().datetime(),
  request_id: requestId
}).strict();
export const workTaskListInput = z.object({
  scope: z.enum(['all', 'recommended', 'mine', 'admin']).default('all'),
  state: z.enum(['open', 'closed', 'all']).default('open'),
  archive_id: z.uuid().optional(),
  labels: z.preprocess(value => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }, z.array(z.string().trim().min(1).max(80)).max(8)).default([]),
  priority: z.enum(taskPriorities).optional(),
  query: z.string().trim().max(200).default(''),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
export const workTaskHistoryInput = z.object({
  id: z.uuid(),
  section: z.enum(['comments', 'events']),
  cursor: z.string().max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100)
}).strict();
