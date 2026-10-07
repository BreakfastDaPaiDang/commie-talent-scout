CREATE TABLE work_task_comment_versions (
  comment_id TEXT NOT NULL REFERENCES work_task_comments(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES work_tasks(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  actor_id TEXT REFERENCES members(id),
  source TEXT NOT NULL CHECK(source IN ('web','mcp','system')),
  body TEXT NOT NULL,
  references_json TEXT NOT NULL DEFAULT '[]',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(comment_id,version)
);
CREATE INDEX work_task_comment_version_stream ON work_task_comment_versions(comment_id,version DESC);
CREATE INDEX work_task_comment_version_task ON work_task_comment_versions(task_id,created_at DESC);
INSERT INTO work_task_comment_versions(comment_id,task_id,version,actor_id,source,body,references_json,deleted_at,created_at)
SELECT id,task_id,version,author_id,'system',body,references_json,deleted_at,updated_at
FROM work_task_comments;
