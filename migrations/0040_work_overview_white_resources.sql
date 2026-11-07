CREATE TABLE work_overview_white_resources (
 id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
 archive_id TEXT NOT NULL REFERENCES archives(id),
 event_id TEXT NOT NULL REFERENCES archive_events(id),
 observation_id TEXT NOT NULL UNIQUE REFERENCES observations(id),
 content_version INTEGER NOT NULL,
 resource_id TEXT REFERENCES work_overview_resources(id),
 capacity INTEGER CHECK(capacity IS NULL OR capacity>=0),
 removed INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL
);
