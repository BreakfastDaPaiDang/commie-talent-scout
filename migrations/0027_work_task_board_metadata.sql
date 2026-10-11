ALTER TABLE work_tasks ADD COLUMN labels_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE work_tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'P2' CHECK(priority IN ('P0','P1','P2'));
ALTER TABLE work_tasks ADD COLUMN initiator_kind TEXT NOT NULL DEFAULT 'member' CHECK(initiator_kind IN ('member','system'));
ALTER TABLE work_tasks ADD COLUMN initiator_id TEXT REFERENCES members(id);

UPDATE work_tasks
SET labels_json = CASE kind
  WHEN 'audit' THEN '["audit"]'
  WHEN 'onboarding' THEN '["onboarding"]'
  WHEN 'monthly' THEN '["monthly"]'
  WHEN 'cooperation' THEN '["cooperation"]'
  ELSE '["custom"]'
END,
priority = CASE WHEN kind IN ('audit','onboarding') THEN 'P1' ELSE 'P2' END,
initiator_id = created_by;

CREATE INDEX work_tasks_board_metadata ON work_tasks(status,updated_at,priority,owner_id);
