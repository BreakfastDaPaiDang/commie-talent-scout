-- Revisions cover the binding set and its current readability, not archive activity.
ALTER TABLE tags ADD COLUMN impact_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tag_categories ADD COLUMN impact_version INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER tag_binding_added AFTER INSERT ON archive_tags BEGIN
 UPDATE tags SET impact_version=impact_version+1 WHERE id=NEW.tag_id;
 UPDATE tag_categories SET impact_version=impact_version+1 WHERE id=(SELECT category_id FROM tags WHERE id=NEW.tag_id);
END;
CREATE TRIGGER tag_binding_removed AFTER DELETE ON archive_tags BEGIN
 UPDATE tags SET impact_version=impact_version+1 WHERE id=OLD.tag_id;
 UPDATE tag_categories SET impact_version=impact_version+1 WHERE id=(SELECT category_id FROM tags WHERE id=OLD.tag_id);
END;
CREATE TRIGGER tag_binding_changed AFTER UPDATE ON archive_tags
WHEN OLD.evidence_json IS NOT NEW.evidence_json OR OLD.focus IS NOT NEW.focus OR OLD.confirmed_at IS NOT NEW.confirmed_at BEGIN
 UPDATE tags SET impact_version=impact_version+1 WHERE id=NEW.tag_id;
 UPDATE tag_categories SET impact_version=impact_version+1 WHERE id=(SELECT category_id FROM tags WHERE id=NEW.tag_id);
END;
CREATE TRIGGER tag_archive_lifecycle AFTER UPDATE OF closed ON archives WHEN OLD.closed<>NEW.closed BEGIN
 UPDATE tags SET impact_version=impact_version+1 WHERE id IN (SELECT tag_id FROM archive_tags WHERE archive_id=NEW.id);
 UPDATE tag_categories SET impact_version=impact_version+1 WHERE id IN (SELECT t.category_id FROM archive_tags b JOIN tags t ON t.id=b.tag_id WHERE b.archive_id=NEW.id);
END;
CREATE TRIGGER tag_source_visibility AFTER UPDATE OF deleted ON observations WHEN OLD.deleted<>NEW.deleted BEGIN
 UPDATE tags SET impact_version=impact_version+1 WHERE id IN (SELECT b.tag_id FROM archive_tags b,json_each(b.evidence_json) e WHERE json_extract(e.value,'$.observation_id')=NEW.id);
 UPDATE tag_categories SET impact_version=impact_version+1 WHERE id IN (SELECT t.category_id FROM archive_tags b JOIN tags t ON t.id=b.tag_id,json_each(b.evidence_json) e WHERE json_extract(e.value,'$.observation_id')=NEW.id);
END;
CREATE TRIGGER tag_definition_added AFTER INSERT ON tags BEGIN
 UPDATE tag_categories SET impact_version=impact_version+1 WHERE id=NEW.category_id;
END;
CREATE TRIGGER tag_definition_changed AFTER UPDATE OF version ON tags WHEN OLD.version<>NEW.version BEGIN
 UPDATE tag_categories SET impact_version=impact_version+1 WHERE id IN (OLD.category_id,NEW.category_id);
END;
CREATE TABLE tag_maintenance_previews (
 id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), auth_epoch INTEGER NOT NULL, role TEXT NOT NULL,
 input_json TEXT NOT NULL, expected_json TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX tag_preview_expiry ON tag_maintenance_previews(expires_at);
