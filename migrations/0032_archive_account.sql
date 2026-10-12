ALTER TABLE archives ADD COLUMN linked_account_id TEXT REFERENCES members(id);
CREATE UNIQUE INDEX archives_linked_account ON archives(linked_account_id) WHERE linked_account_id IS NOT NULL;

CREATE TRIGGER archive_account_insert BEFORE INSERT ON archives
WHEN NEW.linked_account_id IS NOT NULL AND (NEW.type<>'person' OR NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.linked_account_id AND identity_kind='human' AND name=NEW.name))
BEGIN
 SELECT RAISE(ABORT,'invalid archive account identity');
END;
CREATE TRIGGER archive_account_update BEFORE UPDATE OF linked_account_id,name,type ON archives
WHEN NEW.linked_account_id IS NOT NULL AND (NEW.type<>'person' OR NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.linked_account_id AND identity_kind='human' AND name=NEW.name))
BEGIN
 SELECT RAISE(ABORT,'invalid archive account identity');
END;

-- The account profile command writes this event in the same transaction as the
-- account name. Propagate identity display without pretending new contact occurred.
-- Closed/deleted profiles retain the same binding; historical payloads stay intact.
CREATE TRIGGER linked_archive_account_name AFTER INSERT ON member_events
WHEN NEW.kind='member.profile_changed'
BEGIN
 INSERT INTO archive_events(id,archive_id,actor_id,source,kind,before_json,after_json,created_at)
 SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),a.id,NEW.actor_id,NEW.source,'archive.profile_changed',
 json_object('name',a.name,'linked_account_id',a.linked_account_id),
 json_object('name',m.name,'linked_account_id',a.linked_account_id),NEW.created_at
 FROM archives a JOIN members m ON m.id=a.linked_account_id
 WHERE m.id=NEW.member_id AND a.name<>m.name;
 UPDATE archives SET name=(SELECT name FROM members WHERE id=NEW.member_id),version=version+1
 WHERE linked_account_id=NEW.member_id AND name<>(SELECT name FROM members WHERE id=NEW.member_id);
END;
