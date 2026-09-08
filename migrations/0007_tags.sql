CREATE TABLE tag_categories (
 id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('person','org')),
 name TEXT NOT NULL, name_key TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'sage',
 version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 created_by TEXT REFERENCES members(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(type,name_key)
);
CREATE TABLE tags (
 id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES tag_categories(id), name TEXT NOT NULL, name_key TEXT NOT NULL,
 description TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 merged_into TEXT REFERENCES tags(id), created_by TEXT REFERENCES members(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(category_id,name_key)
);
CREATE TABLE tag_definition_history (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, entity_type TEXT NOT NULL CHECK(entity_type IN ('category','tag')),
 version INTEGER NOT NULL, definition_json TEXT NOT NULL, actor_id TEXT REFERENCES members(id), created_at TEXT NOT NULL,
 UNIQUE(entity_type,id,version)
);
CREATE TABLE archive_tags (
 archive_id TEXT NOT NULL REFERENCES archives(id), tag_id TEXT NOT NULL REFERENCES tags(id),
 added_by TEXT NOT NULL REFERENCES members(id), added_at TEXT NOT NULL,
 confirmed_by TEXT NOT NULL REFERENCES members(id), confirmed_at TEXT NOT NULL,
 evidence_json TEXT NOT NULL DEFAULT '[]', focus INTEGER NOT NULL DEFAULT 0 CHECK(focus BETWEEN 0 AND 3),
 PRIMARY KEY(archive_id,tag_id)
);
CREATE INDEX tag_archives ON archive_tags(tag_id,archive_id);
ALTER TABLE archives ADD COLUMN tag_snapshot_version INTEGER;
CREATE TABLE archive_tag_snapshots (
 archive_id TEXT NOT NULL REFERENCES archives(id), close_version INTEGER NOT NULL, tag_id TEXT NOT NULL REFERENCES tags(id),
 data_json TEXT NOT NULL, PRIMARY KEY(archive_id,close_version,tag_id)
);
CREATE TABLE observation_reads (
 credential_id TEXT NOT NULL, observation_id TEXT NOT NULL REFERENCES observations(id), content_version INTEGER NOT NULL,
 read_at TEXT NOT NULL, PRIMARY KEY(credential_id,observation_id,content_version)
);
CREATE TABLE mcp_tasks (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL,
 purpose TEXT, original_request TEXT, agent_summary TEXT, material_type TEXT,
 source_material TEXT, source_references_json TEXT, body_state TEXT NOT NULL DEFAULT 'retained'
);
CREATE INDEX task_member_time ON mcp_tasks(member_id,created_at);
