CREATE TABLE work_task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES members(id),
  body TEXT NOT NULL,
  references_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX work_task_comment_stream ON work_task_comments(task_id,created_at DESC,id DESC);
CREATE INDEX work_task_comment_author ON work_task_comments(author_id,updated_at DESC);
