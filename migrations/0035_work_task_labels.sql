CREATE TABLE work_task_labels (
 key TEXT PRIMARY KEY,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE,
 builtin INTEGER NOT NULL DEFAULT 0 CHECK(builtin IN (0,1)),
 created_by TEXT REFERENCES members(id),
 created_at TEXT NOT NULL
);
INSERT INTO work_task_labels(key,name,builtin,created_at) VALUES
 ('audit','人事审核',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('onboarding','入社对接',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('monthly','月度沟通',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('cooperation','组织合作',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('custom','临时工作',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('接触跟进','接触跟进',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
-- Imported private/deleted-only labels remain undiscoverable without a visible task.
INSERT OR IGNORE INTO work_task_labels(key,name,created_at)
 SELECT lower(trim(j.value)),trim(j.value),min(t.created_at)
 FROM work_tasks t,json_each(t.labels_json) j
 WHERE typeof(j.value)='text' AND length(trim(j.value))>0
 AND NOT EXISTS(SELECT 1 FROM work_task_labels l WHERE l.key=trim(j.value) COLLATE NOCASE OR l.name=trim(j.value) COLLATE NOCASE)
 GROUP BY lower(trim(j.value));
