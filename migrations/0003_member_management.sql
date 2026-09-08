ALTER TABLE commands ADD COLUMN secret_hash TEXT;
ALTER TABLE commands ADD COLUMN require_admin INTEGER NOT NULL DEFAULT 0 CHECK(require_admin IN (0,1));
CREATE TABLE member_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('web','mcp')),
  kind TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX member_events_subject ON member_events(member_id,created_at DESC);
