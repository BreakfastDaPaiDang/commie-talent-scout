CREATE TABLE kw_meta(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0);
INSERT INTO kw_meta(id) VALUES(1);
CREATE TABLE kw_branches(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL, owner_name TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('members','private')), state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','merged','closed')), head_id TEXT, base_head_id TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
INSERT INTO kw_branches VALUES('main','主分支','system','系统','members','open',NULL,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE kw_categories(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, definition TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
CREATE TABLE kw_documents(id TEXT PRIMARY KEY, author_id TEXT NOT NULL, author_name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE kw_versions(id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES kw_documents(id), title TEXT NOT NULL, body TEXT NOT NULL, category_id TEXT REFERENCES kw_categories(id), kind TEXT NOT NULL DEFAULT '知识', source TEXT NOT NULL DEFAULT '', deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)), author_id TEXT NOT NULL, author_name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE kw_items(branch_id TEXT NOT NULL REFERENCES kw_branches(id), document_id TEXT NOT NULL REFERENCES kw_documents(id), version_id TEXT NOT NULL REFERENCES kw_versions(id), base_version_id TEXT REFERENCES kw_versions(id), PRIMARY KEY(branch_id,document_id));
CREATE TABLE kw_commits(id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES kw_branches(id), parent_id TEXT REFERENCES kw_commits(id), merge_parent_id TEXT REFERENCES kw_commits(id), message TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE kw_changes(commit_id TEXT NOT NULL REFERENCES kw_commits(id), document_id TEXT NOT NULL REFERENCES kw_documents(id), before_id TEXT REFERENCES kw_versions(id), after_id TEXT NOT NULL REFERENCES kw_versions(id), PRIMARY KEY(commit_id,document_id));
CREATE TABLE kw_merges(id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES kw_branches(id), head_id TEXT NOT NULL REFERENCES kw_commits(id), title TEXT NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','merged','closed')), author_id TEXT NOT NULL, author_name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, merged_at TEXT, selection_json TEXT CHECK(selection_json IS NULL OR json_valid(selection_json)));
CREATE UNIQUE INDEX kw_one_open_merge ON kw_merges(branch_id) WHERE state='open';
CREATE TABLE kw_approvals(merge_id TEXT NOT NULL REFERENCES kw_merges(id), head_id TEXT NOT NULL REFERENCES kw_commits(id), actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, membership_id TEXT NOT NULL, verified_at TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(merge_id,head_id,actor_id));
CREATE TABLE kw_issues(id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE, title TEXT NOT NULL, body TEXT NOT NULL, document_id TEXT REFERENCES kw_documents(id), state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')), author_id TEXT NOT NULL, author_name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, resolution TEXT NOT NULL DEFAULT '', selected_merge_id TEXT REFERENCES kw_merges(id), candidates_json TEXT CHECK(candidates_json IS NULL OR json_valid(candidates_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE kw_comments(id TEXT PRIMARY KEY, branch_id TEXT REFERENCES kw_branches(id), document_id TEXT REFERENCES kw_documents(id), category_id TEXT REFERENCES kw_categories(id), issue_id TEXT REFERENCES kw_issues(id), parent_id TEXT REFERENCES kw_comments(id), version_id TEXT REFERENCES kw_versions(id), quote TEXT, start_offset INTEGER, end_offset INTEGER, prefix TEXT, suffix TEXT, body TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL, created_at TEXT NOT NULL, CHECK((document_id IS NOT NULL)+(category_id IS NOT NULL)+(issue_id IS NOT NULL)=1), CHECK((quote IS NULL AND start_offset IS NULL AND end_offset IS NULL) OR (quote IS NOT NULL AND version_id IS NOT NULL AND start_offset>=0 AND end_offset>start_offset)));
CREATE INDEX kw_comments_document ON kw_comments(branch_id,document_id,created_at,id);
CREATE INDEX kw_comments_category ON kw_comments(category_id,created_at,id);
CREATE INDEX kw_comments_issue ON kw_comments(issue_id,created_at,id);
CREATE TABLE kw_events(id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, action TEXT NOT NULL, detail_json TEXT NOT NULL CHECK(json_valid(detail_json)), created_at TEXT NOT NULL);
CREATE TABLE kw_requests(actor_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at TEXT NOT NULL, PRIMARY KEY(actor_id,request_id));
CREATE TABLE kw_guards(id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TRIGGER kw_version_immutable BEFORE UPDATE ON kw_versions BEGIN SELECT RAISE(ABORT,'Knowledge versions are immutable'); END;
CREATE TRIGGER kw_version_keep BEFORE DELETE ON kw_versions BEGIN SELECT RAISE(ABORT,'Knowledge versions must be retained'); END;
CREATE TRIGGER kw_commit_immutable BEFORE UPDATE ON kw_commits BEGIN SELECT RAISE(ABORT,'Knowledge commits are immutable'); END;
CREATE TRIGGER kw_commit_keep BEFORE DELETE ON kw_commits BEGIN SELECT RAISE(ABORT,'Knowledge commits must be retained'); END;

-- Keep previously published material in main; never promote private drafts.
INSERT INTO kw_documents SELECT id,author_id,author_name,created_at FROM kb_entries;
INSERT INTO kw_versions SELECT id,entry_id,title,body,NULL,'知识',source,0,author_id,author_name,created_at FROM kb_versions;
INSERT INTO kw_items SELECT 'main',id,active_version_id,NULL FROM kb_entries WHERE active_version_id IS NOT NULL AND closed_at IS NULL;
INSERT INTO kw_branches(id,name,owner_id,owner_name,visibility,created_at,updated_at)
 SELECT 'legacy-'||author_id,'导入草稿 · '||MAX(author_name)||' · '||substr(author_id,1,8),author_id,MAX(author_name),'private',MIN(created_at),MAX(updated_at) FROM kb_versions WHERE state='draft' GROUP BY author_id;
INSERT INTO kw_items(branch_id,document_id,version_id,base_version_id)
 SELECT 'legacy-'||v.author_id,v.entry_id,v.id,e.active_version_id FROM kb_versions v JOIN kb_entries e ON e.id=v.entry_id WHERE v.state='draft' AND v.id=(SELECT x.id FROM kb_versions x WHERE x.state='draft' AND x.author_id=v.author_id AND x.entry_id=v.entry_id ORDER BY x.updated_at DESC,x.id DESC LIMIT 1);
INSERT INTO kw_commits(id,branch_id,message,author_id,author_name,created_at)
 SELECT 'import-'||id,id,'保留已有知识内容',owner_id,owner_name,created_at FROM kw_branches WHERE EXISTS(SELECT 1 FROM kw_items WHERE branch_id=kw_branches.id);
INSERT INTO kw_changes SELECT 'import-'||branch_id,document_id,NULL,version_id FROM kw_items;
UPDATE kw_branches SET head_id='import-'||id WHERE EXISTS(SELECT 1 FROM kw_items WHERE branch_id=kw_branches.id);
