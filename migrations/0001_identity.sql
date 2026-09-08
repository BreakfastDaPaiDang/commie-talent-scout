PRAGMA foreign_keys = ON;
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member')),
  frozen INTEGER NOT NULL DEFAULT 0 CHECK(frozen IN (0,1)),
  auth_epoch INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  qq TEXT,
  avatar_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  hash TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('session','mcp')),
  name TEXT NOT NULL,
  auth_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX credential_member ON credentials(member_id, kind);
CREATE TABLE auth_rates (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX auth_rates_expiry ON auth_rates(expires_at);
CREATE TABLE auth_events (
  id TEXT PRIMARY KEY, member_id TEXT, kind TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE mutation_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
CREATE TABLE commands (
  member_id TEXT NOT NULL, request_id TEXT NOT NULL, input_hash TEXT NOT NULL, result TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY(member_id, request_id)
);
