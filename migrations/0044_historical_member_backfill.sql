-- Each backfill authorizes one version transition and retains its actual observation.
CREATE TABLE personnel_member_backfills (
 archive_id TEXT PRIMARY KEY REFERENCES archives(id),
 target_version INTEGER NOT NULL CHECK(target_version>1),
 observation_id TEXT NOT NULL UNIQUE REFERENCES observations(id),
 recorded_at TEXT NOT NULL
);
DROP TRIGGER personnel_no_skip_stages;
CREATE TRIGGER personnel_no_skip_stages BEFORE UPDATE OF status ON archives
 WHEN NEW.type='person' AND NEW.status<>OLD.status AND NEW.status IN ('已加入待对接','已入伙')
 AND NOT (NEW.status='已加入待对接' AND OLD.status='人事审核' AND EXISTS(SELECT 1 FROM work_tasks WHERE archive_id=NEW.id AND kind='audit' AND source='rule' AND status='open'))
 AND NOT (NEW.status='已入伙' AND OLD.status='已加入待对接' AND EXISTS(SELECT 1 FROM work_tasks WHERE archive_id=NEW.id AND kind='onboarding' AND source='rule' AND status='open'))
 AND NOT (NEW.status='已入伙' AND OLD.closed=0 AND OLD.deleted=0
  AND NEW.person_role='member' AND NEW.version=OLD.version+1
  AND EXISTS(SELECT 1 FROM personnel_member_backfills b
    WHERE b.archive_id=NEW.id AND b.target_version=NEW.version AND b.recorded_at=NEW.updated_at))
 BEGIN SELECT RAISE(ABORT,'personnel task delivery required'); END;
