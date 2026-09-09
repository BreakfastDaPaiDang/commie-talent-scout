ALTER TABLE tags ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1));
ALTER TABLE tag_categories ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1));
ALTER TABLE tags ADD COLUMN deleted_name_key TEXT;
ALTER TABLE tag_categories ADD COLUMN deleted_name_key TEXT;
CREATE INDEX tag_category_lifecycle ON tag_categories(type,deleted,enabled);
CREATE INDEX tag_lifecycle ON tags(category_id,deleted,enabled);
