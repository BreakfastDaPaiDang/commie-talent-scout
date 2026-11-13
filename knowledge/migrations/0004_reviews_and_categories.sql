-- Independent category editing and immutable definitions reuse the existing text-version store.
ALTER TABLE kw_categories ADD COLUMN independent INTEGER NOT NULL DEFAULT 0 CHECK(independent IN (0,1));
ALTER TABLE kw_categories ADD COLUMN definition_version_id TEXT REFERENCES kw_versions(id);
INSERT INTO kw_documents SELECT 'category-'||id,'system','系统',updated_at FROM kw_categories;
INSERT INTO kw_versions SELECT 'category-definition-'||id,'category-'||id,name,definition,id,'分类解释','',0,'system','系统',updated_at FROM kw_categories;
UPDATE kw_categories SET definition_version_id='category-definition-'||id;
ALTER TABLE kw_merges ADD COLUMN auto_promote INTEGER NOT NULL DEFAULT 0 CHECK(auto_promote IN (0,1));
CREATE TABLE kw_review_sources(source_branch_id TEXT NOT NULL REFERENCES kw_branches(id),document_id TEXT NOT NULL REFERENCES kw_documents(id),source_version_id TEXT NOT NULL REFERENCES kw_versions(id),merge_id TEXT NOT NULL REFERENCES kw_merges(id),PRIMARY KEY(source_branch_id,document_id,source_version_id));
ALTER TABLE kw_issues ADD COLUMN category_id TEXT REFERENCES kw_categories(id);
ALTER TABLE kw_issues ADD COLUMN source_comment_id TEXT REFERENCES kw_comments(id);
ALTER TABLE kw_issues ADD COLUMN source_json TEXT CHECK(source_json IS NULL OR json_valid(source_json));
