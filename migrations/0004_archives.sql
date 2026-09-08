CREATE TABLE archives (
 id TEXT PRIMARY KEY,
 type TEXT NOT NULL CHECK(type IN ('person','org')),
 name TEXT NOT NULL,
 contacts_json TEXT NOT NULL DEFAULT '[]',
 links_json TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL DEFAULT '视奸观察',
 closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1)),
 last_open_status TEXT,
 avatar_id TEXT,
 created_by TEXT NOT NULL REFERENCES members(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX archive_activity ON archives(type,updated_at DESC,id DESC);
CREATE TABLE archive_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 archive_id TEXT NOT NULL REFERENCES archives(id),
 actor_id TEXT NOT NULL REFERENCES members(id),
 source TEXT NOT NULL CHECK(source IN ('web','mcp')),
 kind TEXT NOT NULL,
 before_json TEXT,
 after_json TEXT,
 observation_id TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX archive_event_stream ON archive_events(archive_id,seq DESC);
