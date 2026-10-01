CREATE TABLE member_work_preferences (
 member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
 all_work INTEGER NOT NULL DEFAULT 0 CHECK(all_work IN (0,1)),
 kinds_json TEXT NOT NULL DEFAULT '[]',
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX member_work_preferences_updated ON member_work_preferences(updated_at,member_id);
