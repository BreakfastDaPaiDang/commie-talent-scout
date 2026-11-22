CREATE TABLE kw_reading_defaults (
  actor_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  additional_scope_ids_json TEXT NOT NULL CHECK(json_valid(additional_scope_ids_json) AND json_type(additional_scope_ids_json) = 'array')
);
