CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  task_id TEXT REFERENCES work_tasks(id) ON DELETE CASCADE,
  object_type TEXT NOT NULL DEFAULT 'work_task',
  object_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  task_version INTEGER,
  deadline_at TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(recipient_id,kind,object_type,object_id,deadline_at)
);
CREATE INDEX messages_recipient_unread ON messages(recipient_id,read_at,created_at DESC,id DESC);
CREATE INDEX messages_task_version ON messages(task_id,task_version,deadline_at);
