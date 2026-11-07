CREATE TABLE work_recommendation_links (
 task_id TEXT PRIMARY KEY REFERENCES work_tasks(id),
 archive_id TEXT NOT NULL REFERENCES archives(id),
 observation_id TEXT NOT NULL REFERENCES observations(id),
 content_version INTEGER NOT NULL,
 target_kind TEXT NOT NULL CHECK(target_kind IN ('resource','person','task')),
 target_id TEXT NOT NULL,
 target_version INTEGER NOT NULL,
 target_name TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(archive_id,observation_id,content_version,target_kind,target_id)
);
CREATE INDEX work_recommendations_archive ON work_recommendation_links(archive_id,created_at);
