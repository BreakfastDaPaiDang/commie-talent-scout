import { taskKinds, taskPriorities } from "../../rules/task-policy.ts";
export type Row = {
  has_owner_round_observation?: number;
  follow_up?: number;
  round_started_at?: string;
  automation_rule: string | null;
  id: string;
  archive_id: string | null;
  kind: typeof taskKinds[number];
  labels_json: string;
  priority: typeof taskPriorities[number];
  initiator_kind: 'member' | 'system';
  initiator_id: string | null;
  title: string;
  purpose: string;
  delivery: string;
  source: 'manual' | 'rule';
  status: 'open' | 'completed' | 'expired' | 'cancelled';
  owner_id: string | null;
  deadline_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
  result_kind: string | null;
  result_text: string | null;
  result_references_json: string;
  completed_at: string | null;
  closed_reason: string | null;
  period_key: string | null;
};
export type CommentRow = {
  id: string;
  task_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  references_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
};
export type CommentVersionRow = {
  comment_id: string;
  task_id: string;
  version: number;
  actor_id: string | null;
  source: 'web' | 'mcp' | 'system';
  body: string;
  references_json: string;
  deleted_at: string | null;
  created_at: string;
};

// Shared by list and detail; only the current owner's newly created, live observations count.
