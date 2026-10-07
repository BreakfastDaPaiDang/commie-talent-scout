ALTER TABLE work_tasks ADD COLUMN period_key TEXT;
CREATE UNIQUE INDEX work_tasks_monthly_period ON work_tasks(archive_id,kind,period_key) WHERE kind='monthly' AND period_key IS NOT NULL;
