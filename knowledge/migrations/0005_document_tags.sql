CREATE TABLE kw_version_tags (
  version_id TEXT NOT NULL REFERENCES kw_versions(id),
  category_id TEXT NOT NULL REFERENCES kw_categories(id),
  position INTEGER NOT NULL CHECK(position > 0),
  PRIMARY KEY(version_id, category_id),
  UNIQUE(version_id, position)
);
CREATE INDEX kw_version_tags_category ON kw_version_tags(category_id, version_id);

-- Older writers still store the first tag on the version itself.
CREATE VIEW kw_document_tags AS
  SELECT id AS version_id, category_id, 0 AS position FROM kw_versions WHERE category_id IS NOT NULL
  UNION ALL
  SELECT version_id, category_id, position FROM kw_version_tags;
