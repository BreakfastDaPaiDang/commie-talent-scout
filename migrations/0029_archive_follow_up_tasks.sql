ALTER TABLE work_tasks ADD COLUMN automation_rule TEXT;
ALTER TABLE work_tasks ADD COLUMN automation_key TEXT;
CREATE UNIQUE INDEX work_tasks_automation_cycle ON work_tasks(archive_id,automation_rule,automation_key)
  WHERE automation_rule IS NOT NULL AND automation_key IS NOT NULL;
CREATE INDEX work_tasks_automation_open ON work_tasks(archive_id,automation_rule,status);
