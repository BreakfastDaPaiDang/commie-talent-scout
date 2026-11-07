-- Remove resources from the live catalog without rewriting experience history.
ALTER TABLE work_overview_resources ADD COLUMN deleted_at TEXT;
