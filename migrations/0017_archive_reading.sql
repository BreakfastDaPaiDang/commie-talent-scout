CREATE TABLE archive_reading_deliveries (
 id TEXT PRIMARY KEY,
 credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id),
 archive_id TEXT NOT NULL REFERENCES archives(id),
 through_seq INTEGER NOT NULL CHECK(through_seq>=0),
 expires_at TEXT NOT NULL,
 confirmed_at TEXT
);
CREATE INDEX archive_reading_deliveries_expiry ON archive_reading_deliveries(expires_at);
CREATE INDEX archive_reading_deliveries_archive ON archive_reading_deliveries(archive_id);
CREATE TABLE archive_reading_delivery_events (
 delivery_id TEXT NOT NULL REFERENCES archive_reading_deliveries(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL REFERENCES archive_events(id),
 PRIMARY KEY(delivery_id,event_id)
);
CREATE TRIGGER archive_reading_trash AFTER UPDATE OF deleted ON archives WHEN OLD.deleted<>NEW.deleted BEGIN
 DELETE FROM archive_reading_deliveries WHERE archive_id=NEW.id;
END;
