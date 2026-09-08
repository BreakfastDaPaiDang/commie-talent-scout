CREATE TABLE archive_bindings (
 archive_id TEXT NOT NULL REFERENCES archives(id),
 status TEXT NOT NULL,
 member_id TEXT NOT NULL REFERENCES members(id),
 PRIMARY KEY(archive_id,status,member_id)
);
CREATE INDEX binding_member ON archive_bindings(member_id,archive_id,status);
