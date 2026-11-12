CREATE TABLE resource_catalog_state (id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('legacy','migrating','independent')), imported_digest TEXT, changed_at TEXT NOT NULL);
INSERT INTO resource_catalog_state VALUES(1,'legacy',NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
-- The gate remains effective even if old application code is rolled back.
CREATE TRIGGER resource_authority_insert BEFORE INSERT ON work_overview_resources
WHEN (SELECT mode FROM resource_catalog_state WHERE id=1)<>'legacy'
 AND NOT ((SELECT mode FROM resource_catalog_state WHERE id=1)='independent' AND NEW.version=0 AND NEW.name='' AND NEW.kind='' AND NEW.purposes_json='[]' AND NEW.capacity IS NULL AND NEW.active=0 AND NEW.note='')
BEGIN SELECT RAISE(ABORT,'resources are owned by the independent catalog'); END;
CREATE TRIGGER resource_authority_update BEFORE UPDATE ON work_overview_resources
WHEN (SELECT mode FROM resource_catalog_state WHERE id=1)<>'legacy'
BEGIN SELECT RAISE(ABORT,'resources are owned by the independent catalog'); END;
CREATE TRIGGER resource_authority_delete BEFORE DELETE ON work_overview_resources
WHEN (SELECT mode FROM resource_catalog_state WHERE id=1)<>'legacy'
BEGIN SELECT RAISE(ABORT,'resources are owned by the independent catalog'); END;
