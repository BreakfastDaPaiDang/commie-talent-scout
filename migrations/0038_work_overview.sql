-- Independent replacement; legacy graph tables remain historical and are not read.
CREATE TABLE work_overview_resources (
 id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
 name TEXT NOT NULL, kind TEXT NOT NULL, purposes_json TEXT NOT NULL,
 capacity INTEGER CHECK(capacity IS NULL OR capacity>=0), active INTEGER NOT NULL DEFAULT 1,
 note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE TABLE work_overview_gaps (
 id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
 purpose TEXT NOT NULL, work TEXT NOT NULL, missing TEXT NOT NULL,
 resolved INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE work_overview_placements (
 id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
 archive_id TEXT NOT NULL REFERENCES archives(id), event_id TEXT NOT NULL REFERENCES archive_events(id),
 resource_ids_json TEXT NOT NULL, note TEXT NOT NULL, usage TEXT NOT NULL CHECK(usage IN ('planned','active')),
 updated_at TEXT NOT NULL, UNIQUE(archive_id,event_id)
);
CREATE TABLE work_overview_history (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES members(id), before_json TEXT, after_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);

CREATE TABLE work_overview_followups (
 task_id TEXT PRIMARY KEY REFERENCES work_tasks(id),
 archive_id TEXT NOT NULL REFERENCES archives(id)
);
