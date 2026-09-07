PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('member','admin')),
  frozen INTEGER NOT NULL DEFAULT 0 CHECK(frozen IN (0,1)),
  auth_epoch INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS credentials (
  hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  auth_epoch INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'observing',
  closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  author_id TEXT NOT NULL REFERENCES members(id),
  body TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS revisions (
  record_id TEXT NOT NULL REFERENCES records(id),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  deleted INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(record_id,version)
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  uploader_id TEXT NOT NULL REFERENCES members(id),
  object_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded INTEGER NOT NULL DEFAULT 0,
  ticket_hash TEXT,
  ticket_expires TEXT,
  ticket_epoch INTEGER NOT NULL DEFAULT 0,
  record_id TEXT REFERENCES records(id)
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT REFERENCES entities(id),
  actor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_entity_seq ON events(entity_id,seq DESC);
CREATE TABLE IF NOT EXISTS reads (
  member_id TEXT NOT NULL REFERENCES members(id),
  event_seq INTEGER NOT NULL REFERENCES events(seq),
  PRIMARY KEY(member_id,event_seq)
);
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL
);
-- Failing CHECK constraints abort the complete D1 batch, including earlier writes.
-- Rows are inserted/deleted within one batch and never persist on success.
CREATE TABLE IF NOT EXISTS mutation_guards (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK(ok=1)
);
