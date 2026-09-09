ALTER TABLE archives ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1));
ALTER TABLE archives ADD COLUMN deleted_at TEXT;
ALTER TABLE archives ADD COLUMN deleted_by TEXT REFERENCES members(id);
ALTER TABLE archives ADD COLUMN deleted_snapshot_version INTEGER;
CREATE INDEX archive_trash_list ON archives(deleted,type,updated_at DESC,id DESC);
CREATE TRIGGER tag_archive_trash AFTER UPDATE OF deleted ON archives WHEN OLD.deleted<>NEW.deleted BEGIN
 UPDATE tags SET impact_version=impact_version+1 WHERE id IN (SELECT tag_id FROM archive_tags WHERE archive_id=NEW.id);
 UPDATE tag_categories SET impact_version=impact_version+1 WHERE id IN (SELECT t.category_id FROM archive_tags b JOIN tags t ON t.id=b.tag_id WHERE b.archive_id=NEW.id);
 -- Tickets issued before deletion must not become valid again on restoration.
 DELETE FROM reading_deliveries WHERE event_id IN (SELECT id FROM archive_events WHERE archive_id=NEW.id);
END;
