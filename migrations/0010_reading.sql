CREATE TABLE event_read_marks (
 member_id TEXT NOT NULL REFERENCES members(id),
 event_id TEXT NOT NULL REFERENCES archive_events(id),
 read_at TEXT NOT NULL,
 PRIMARY KEY(member_id,event_id)
);
CREATE TABLE reading_deliveries (
 id TEXT PRIMARY KEY,
 credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL REFERENCES members(id),
 event_id TEXT NOT NULL REFERENCES archive_events(id),
 observation_version INTEGER,
 expires_at TEXT NOT NULL
);
CREATE INDEX reading_deliveries_expiry ON reading_deliveries(expires_at);
CREATE INDEX archive_events_observation_seq ON archive_events(observation_id,seq DESC);
CREATE INDEX archive_events_created_seq ON archive_events(created_at,seq DESC);
