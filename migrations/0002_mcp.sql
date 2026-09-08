ALTER TABLE credentials ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE mcp_calls (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  outcome TEXT NOT NULL CHECK(outcome IN ('success','no_change','rejected','failed','unknown')),
  error_code TEXT,
  request_id TEXT,
  task_id TEXT,
  parameters_json TEXT,
  result_json TEXT,
  body_state TEXT NOT NULL DEFAULT 'retained',
  client_name TEXT,
  client_version TEXT
);
CREATE INDEX mcp_calls_time ON mcp_calls(started_at DESC,id DESC);
CREATE INDEX mcp_calls_member ON mcp_calls(member_id,started_at DESC);
CREATE INDEX mcp_calls_task ON mcp_calls(task_id,started_at);
CREATE TABLE mcp_diagnostics (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(day,kind)
);
