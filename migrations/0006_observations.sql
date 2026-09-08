CREATE TABLE observations (
 id TEXT PRIMARY KEY,
 archive_id TEXT NOT NULL REFERENCES archives(id),
 author_id TEXT NOT NULL REFERENCES members(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 content_version INTEGER NOT NULL DEFAULT 1,
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
 deleted_at TEXT,
 deleted_by TEXT REFERENCES members(id)
);
CREATE INDEX observation_archive_activity ON observations(archive_id,deleted,updated_at DESC,id DESC);
CREATE TABLE observation_versions (
 observation_id TEXT NOT NULL REFERENCES observations(id),
 version INTEGER NOT NULL,
 body TEXT NOT NULL,
 occurred_at TEXT,
 editor_id TEXT NOT NULL REFERENCES members(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(observation_id,version)
);
CREATE TABLE observation_drafts (
 member_id TEXT NOT NULL REFERENCES members(id),
 archive_id TEXT NOT NULL REFERENCES archives(id),
 body TEXT NOT NULL,
 occurred_at TEXT,
 version INTEGER NOT NULL,
 publish_request_id TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(member_id,archive_id)
);
CREATE INDEX draft_expiration ON observation_drafts(updated_at);
