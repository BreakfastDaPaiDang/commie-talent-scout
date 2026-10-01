CREATE TABLE work_tasks (
  id TEXT PRIMARY KEY,
  archive_id TEXT REFERENCES archives(id),
  kind TEXT NOT NULL CHECK(kind IN ('audit','onboarding','monthly','cooperation','custom')),
  title TEXT NOT NULL,
  purpose TEXT NOT NULL,
  delivery TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('manual','rule')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','expired','cancelled')),
  owner_id TEXT REFERENCES members(id),
  deadline_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX work_tasks_board ON work_tasks(status,owner_id,deadline_at,updated_at);
CREATE INDEX work_tasks_archive ON work_tasks(archive_id,status,updated_at);

CREATE TABLE work_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES members(id),
  source TEXT NOT NULL CHECK(source IN ('web','mcp','system')),
  kind TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX work_task_event_stream ON work_task_events(task_id,created_at DESC,id DESC);

CREATE TABLE work_task_pushes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK(stage IN ('initial','reminder')),
  pushed_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE(task_id,member_id,stage)
);
CREATE INDEX work_task_push_member ON work_task_pushes(member_id,pushed_at DESC);
