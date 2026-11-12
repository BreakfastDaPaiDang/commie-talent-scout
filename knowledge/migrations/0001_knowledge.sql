PRAGMA foreign_keys=ON;
CREATE TABLE kb_meta(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0);
INSERT INTO kb_meta(id) VALUES(1);
CREATE TABLE kb_tags(name TEXT PRIMARY KEY CHECK(length(name) BETWEEN 1 AND 40));
INSERT INTO kb_tags VALUES('共识'),('方法'),('题目');
CREATE TABLE kb_entries(
 id TEXT PRIMARY KEY, author_id TEXT NOT NULL, author_name TEXT NOT NULL,
 created_at TEXT NOT NULL, public_at TEXT, active_version_id TEXT REFERENCES kb_versions(id),
 closed_at TEXT, revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE kb_versions(
 id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES kb_entries(id),
 author_id TEXT NOT NULL, author_name TEXT NOT NULL, title TEXT NOT NULL,
 body TEXT NOT NULL, tags_json TEXT NOT NULL CHECK(json_valid(tags_json)),
 source TEXT NOT NULL DEFAULT '', base_version_id TEXT REFERENCES kb_versions(id),
 state TEXT NOT NULL CHECK(state IN ('draft','submitted')),
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE kb_proposals(
 id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES kb_entries(id),
 version_id TEXT REFERENCES kb_versions(id), base_version_id TEXT REFERENCES kb_versions(id),
 kind TEXT NOT NULL CHECK(kind IN ('publish','close')),
 author_id TEXT NOT NULL, author_name TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','expired','superseded')),
 submitted_at TEXT NOT NULL, deadline_at TEXT NOT NULL, decided_at TEXT,
 CHECK((kind='publish' AND version_id IS NOT NULL) OR (kind='close' AND version_id IS NULL))
);
CREATE UNIQUE INDEX kb_proposal_version ON kb_proposals(version_id) WHERE version_id IS NOT NULL;
CREATE INDEX kb_proposal_entry ON kb_proposals(entry_id,status,deadline_at);
CREATE TABLE kb_votes(
 proposal_id TEXT NOT NULL REFERENCES kb_proposals(id), actor_id TEXT NOT NULL,
 actor_name TEXT NOT NULL, membership_id TEXT NOT NULL, verified_at TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(proposal_id,actor_id)
);
CREATE TABLE kb_events(
 seq INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL REFERENCES kb_entries(id),
 actor_id TEXT NOT NULL, kind TEXT NOT NULL, detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
 created_at TEXT NOT NULL
);
CREATE TABLE kb_requests(
 actor_id TEXT NOT NULL, request_id TEXT NOT NULL, input_hash TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL,
 PRIMARY KEY(actor_id,request_id)
);
CREATE TABLE kb_guards(id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE kb_imports(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,content_hash TEXT NOT NULL,item_count INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX kb_version_entry ON kb_versions(entry_id,state,author_id);
CREATE TRIGGER kb_version_immutable BEFORE UPDATE ON kb_versions WHEN OLD.state='submitted'
BEGIN SELECT RAISE(ABORT,'Submitted knowledge is immutable'); END;
CREATE TRIGGER kb_version_keep BEFORE DELETE ON kb_versions
BEGIN SELECT RAISE(ABORT,'Knowledge history must be preserved'); END;
