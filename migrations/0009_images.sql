CREATE TABLE attachments (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES members(id), auth_epoch INTEGER NOT NULL, credential_id TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('observation','archive_avatar','member_avatar')),
 archive_id TEXT REFERENCES archives(id), member_subject_id TEXT REFERENCES members(id), observation_id TEXT REFERENCES observations(id),
 mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL CHECK(byte_size>0 AND byte_size<=10485760), sha256 TEXT NOT NULL,
 ticket_hash TEXT NOT NULL, ticket_expires_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','uploading','ready','cleaning','expired')),
 upload_claim TEXT, lease_until TEXT, object_key TEXT NOT NULL UNIQUE,
 width INTEGER, height INTEGER, created_at TEXT NOT NULL, ready_at TEXT,
 CHECK((purpose='member_avatar' AND member_subject_id IS NOT NULL AND archive_id IS NULL) OR (purpose<>'member_avatar' AND archive_id IS NOT NULL AND member_subject_id IS NULL))
);
CREATE INDEX attachment_cleanup ON attachments(state,created_at);
CREATE INDEX attachment_owner ON attachments(owner_id,created_at);
CREATE TABLE version_attachments (
 observation_id TEXT NOT NULL, content_version INTEGER NOT NULL, attachment_id TEXT NOT NULL REFERENCES attachments(id), position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 9),
 PRIMARY KEY(observation_id,content_version,position), UNIQUE(observation_id,content_version,attachment_id),
 FOREIGN KEY(observation_id,content_version) REFERENCES observation_versions(observation_id,version)
);
CREATE INDEX attachment_versions ON version_attachments(attachment_id);
CREATE TABLE draft_attachments (
 member_id TEXT NOT NULL, archive_id TEXT NOT NULL, attachment_id TEXT NOT NULL REFERENCES attachments(id), position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 9),
 PRIMARY KEY(member_id,archive_id,position), UNIQUE(member_id,archive_id,attachment_id),
 FOREIGN KEY(member_id,archive_id) REFERENCES observation_drafts(member_id,archive_id) ON DELETE CASCADE
);
CREATE INDEX attachment_drafts ON draft_attachments(attachment_id);
CREATE TABLE avatar_history (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, subject_type TEXT NOT NULL CHECK(subject_type IN ('archive','member')), subject_id TEXT NOT NULL,
 attachment_id TEXT REFERENCES attachments(id), previous_attachment_id TEXT REFERENCES attachments(id), actor_id TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL
);
CREATE INDEX attachment_avatars ON avatar_history(attachment_id);
CREATE TABLE qq_avatar_cache (
 qq TEXT PRIMARY KEY, object_key TEXT, mime_type TEXT, refreshed_at TEXT, refresh_after TEXT NOT NULL, refreshing_until TEXT,
 version INTEGER NOT NULL DEFAULT 1
);
