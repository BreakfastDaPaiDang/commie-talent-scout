-- One optional structured field on existing archives; existing identities and workflows are unchanged.
ALTER TABLE archives ADD COLUMN resources_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(resources_json) AND json_type(resources_json)='array');
