-- members now provides the common foreign-key identity anchor. Service identities
-- are NOT login accounts: no credentials, password reset or admin role.
ALTER TABLE members ADD COLUMN identity_kind TEXT NOT NULL DEFAULT 'human' CHECK(identity_kind IN ('human','service'));
CREATE TABLE service_subjects (
 id TEXT PRIMARY KEY REFERENCES members(id),
 service_key TEXT NOT NULL UNIQUE,
 avatar_asset TEXT NOT NULL,
 created_at TEXT NOT NULL,
 CHECK(service_key <> '')
);
INSERT INTO members(id,username,name,role,frozen,password_hash,must_change_password,identity_kind,created_at)
 VALUES('00000000-0000-4000-8000-000000000083','zaoji-hr','早纪（人事版）','member',0,'!service-no-password',0,'service',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
INSERT INTO service_subjects(id,service_key,avatar_asset,created_at)
 SELECT id,'zaoji-hr','/art/zaoji-hr.png',created_at FROM members WHERE identity_kind='service';

CREATE TRIGGER service_identity_no_access BEFORE UPDATE ON members
 WHEN OLD.identity_kind='service' AND (NEW.identity_kind<>'service' OR NEW.role<>'member' OR NEW.password_hash<>'!service-no-password' OR NEW.must_change_password<>0)
 BEGIN SELECT RAISE(ABORT,'service identity cannot become a login account'); END;
CREATE TRIGGER service_identity_no_credentials BEFORE INSERT ON credentials
 WHEN EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id AND identity_kind='service')
 BEGIN SELECT RAISE(ABORT,'service credentials are not supported'); END;
CREATE TRIGGER service_identity_no_credential_rebind BEFORE UPDATE OF member_id ON credentials
 WHEN EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id AND identity_kind='service')
 BEGIN SELECT RAISE(ABORT,'service credentials are not supported'); END;

CREATE TABLE service_subject_events (
 id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES service_subjects(id),
 kind TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO service_subject_events(id,subject_id,kind,after_json,created_at)
 SELECT 'zaoji-service-created',id,'member.created',json_object('username','zaoji-hr','name','早纪（人事版）','identity_kind','service','origin','migration:0030'),created_at FROM service_subjects WHERE service_key='zaoji-hr';

-- Preserve the original event history; record the attribution correction.
INSERT INTO work_task_events(id,task_id,actor_id,source,kind,before_json,after_json,reason,created_at)
 SELECT 'service-attribution-'||id,id,'00000000-0000-4000-8000-000000000083','system','task.initiator_bound',
 json_object('created_by',created_by,'initiator_id',initiator_id),
 json_object('service_key','zaoji-hr','initiator_id','00000000-0000-4000-8000-000000000083'),
 '将既有系统任务绑定到早纪服务身份',strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM work_tasks WHERE initiator_kind='system' AND initiator_id IS NULL;
UPDATE work_tasks SET created_by='00000000-0000-4000-8000-000000000083',initiator_id='00000000-0000-4000-8000-000000000083'
 WHERE initiator_kind='system' AND initiator_id IS NULL;
