-- Personnel recommendations are independent of knowledge-version approvals.
CREATE TABLE personnel_recognition_rounds (
 id TEXT PRIMARY KEY, archive_id TEXT NOT NULL REFERENCES archives(id),
 number INTEGER NOT NULL CHECK(number>0), state TEXT NOT NULL CHECK(state IN ('collecting','reviewing','closed')),
 task_id TEXT UNIQUE REFERENCES work_tasks(id), legacy INTEGER NOT NULL DEFAULT 0 CHECK(legacy IN (0,1)),
 created_at TEXT NOT NULL, ended_at TEXT, UNIQUE(archive_id,number)
);
CREATE UNIQUE INDEX personnel_one_active_round ON personnel_recognition_rounds(archive_id) WHERE state<>'closed';
CREATE TABLE personnel_recognitions (
 id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES personnel_recognition_rounds(id),
 member_archive_id TEXT NOT NULL REFERENCES archives(id), account_id TEXT NOT NULL REFERENCES members(id),
 observation_id TEXT NOT NULL, content_version INTEGER NOT NULL,
 month TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot IN (1,2)),
 created_at TEXT NOT NULL, withdrawn_at TEXT,
 FOREIGN KEY(observation_id,content_version) REFERENCES observation_versions(observation_id,version),
 UNIQUE(round_id,member_archive_id), UNIQUE(member_archive_id,month,slot)
);
-- Existing members and already-started reviews are preserved, without fabricating votes.
CREATE TABLE personnel_legacy_archives (archive_id TEXT PRIMARY KEY REFERENCES archives(id));
INSERT INTO personnel_legacy_archives SELECT id FROM archives WHERE type='person' AND status IN ('人事审核','已加入待对接','已入伙');
INSERT INTO personnel_recognition_rounds(id,archive_id,number,state,task_id,legacy,created_at)
 SELECT lower(hex(randomblob(16))),a.id,1,'reviewing',t.id,1,t.created_at
 FROM archives a JOIN work_tasks t ON t.archive_id=a.id AND t.kind='audit' AND t.source='rule' AND t.status='open'
 WHERE a.status='人事审核' AND t.id=(SELECT id FROM work_tasks WHERE archive_id=a.id AND kind='audit' AND source='rule' AND status='open' ORDER BY created_at DESC,id DESC LIMIT 1);
CREATE TRIGGER personnel_round_task_closed AFTER UPDATE OF status ON work_tasks
 WHEN OLD.status='open' AND NEW.status<>'open'
 BEGIN UPDATE personnel_recognition_rounds SET state='closed',ended_at=NEW.updated_at WHERE task_id=NEW.id; END;
CREATE TRIGGER personnel_round_archive_closed AFTER UPDATE OF closed,deleted,status ON archives
 WHEN NEW.closed=1 OR NEW.deleted=1 OR (OLD.status='人事审核' AND NEW.status NOT IN ('人事审核','已加入待对接','已入伙'))
 BEGIN UPDATE personnel_recognition_rounds SET state='closed',ended_at=NEW.updated_at WHERE archive_id=NEW.id AND state<>'closed'; END;
-- These gates also protect against old-code rollback restoring direct review submission.
CREATE TRIGGER personnel_no_direct_insert BEFORE INSERT ON archives
 WHEN NEW.type='person' AND NEW.status IN ('人事审核','已加入待对接','已入伙')
 BEGIN SELECT RAISE(ABORT,'personnel recognition required'); END;
CREATE TRIGGER personnel_review_gate BEFORE UPDATE OF status ON archives
 WHEN NEW.type='person' AND NEW.status='人事审核' AND OLD.status<>NEW.status
 AND NOT EXISTS(SELECT 1 FROM personnel_recognition_rounds r WHERE r.archive_id=NEW.id AND r.state='reviewing' AND r.legacy=0
  AND (SELECT count(*) FROM personnel_recognitions v JOIN observations o ON o.id=v.observation_id WHERE v.round_id=r.id AND v.withdrawn_at IS NULL AND o.deleted=0)>=3)
 BEGIN SELECT RAISE(ABORT,'personnel recognition required'); END;
CREATE TRIGGER personnel_no_skip_stages BEFORE UPDATE OF status ON archives
 WHEN NEW.type='person' AND NEW.status<>OLD.status AND NEW.status IN ('已加入待对接','已入伙')
 AND NOT (NEW.status='已加入待对接' AND OLD.status='人事审核' AND EXISTS(SELECT 1 FROM work_tasks WHERE archive_id=NEW.id AND kind='audit' AND source='rule' AND status='open'))
 AND NOT (NEW.status='已入伙' AND OLD.status='已加入待对接' AND EXISTS(SELECT 1 FROM work_tasks WHERE archive_id=NEW.id AND kind='onboarding' AND source='rule' AND status='open'))
 BEGIN SELECT RAISE(ABORT,'personnel task delivery required'); END;
