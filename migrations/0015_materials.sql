ALTER TABLE archives ADD COLUMN material_quota_bytes INTEGER CHECK(material_quota_bytes IS NULL OR material_quota_bytes>=100000000);
ALTER TABLE archives ADD COLUMN material_quota_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE materials (
 id TEXT PRIMARY KEY,
 archive_id TEXT NOT NULL REFERENCES archives(id),
 owner_id TEXT NOT NULL REFERENCES members(id),
 source TEXT NOT NULL CHECK(source IN ('web','mcp')),
 name TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 mime_type TEXT NOT NULL,
 byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=100000000),
 sha256 TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','uploading','ready','cancelled','expired','purging','purged')),
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 ready_at TEXT,
 deleted_at TEXT,
 ticket_hash TEXT NOT NULL,
 ticket_expires_at TEXT NOT NULL,
 credential_id TEXT NOT NULL,
 auth_epoch INTEGER NOT NULL,
 upload_claim TEXT,
 lease_until TEXT
);
CREATE INDEX materials_archive ON materials(archive_id,state,deleted,created_at DESC,id DESC);
CREATE INDEX materials_cleanup ON materials(state,ticket_expires_at,lease_until);
