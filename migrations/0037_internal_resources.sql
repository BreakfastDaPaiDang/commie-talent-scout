-- Explicit internal inventory. Existing archive resource entries remain unclassified until linked.
CREATE TABLE internal_resources (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 stages_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('accepting','paused','archived')),
 capacity INTEGER CHECK(capacity IS NULL OR capacity>=0), members_json TEXT NOT NULL DEFAULT '[]',
 version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL REFERENCES members(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE internal_resource_events (
 id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES internal_resources(id), actor_id TEXT NOT NULL REFERENCES members(id),
 source TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX internal_resource_events_resource ON internal_resource_events(resource_id,created_at,id);
