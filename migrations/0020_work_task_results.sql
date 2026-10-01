ALTER TABLE work_tasks ADD COLUMN result_kind TEXT;
ALTER TABLE work_tasks ADD COLUMN result_text TEXT;
ALTER TABLE work_tasks ADD COLUMN completed_at TEXT;
ALTER TABLE work_tasks ADD COLUMN closed_reason TEXT;
CREATE INDEX work_tasks_completed ON work_tasks(completed_at,status);
