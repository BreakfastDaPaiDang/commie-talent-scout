ALTER TABLE kw_categories ADD COLUMN pending INTEGER NOT NULL DEFAULT 0 CHECK(pending IN (0,1));
CREATE TABLE kw_tag_proposals(
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES kw_categories(id),
  name TEXT NOT NULL, definition TEXT NOT NULL, base_version INTEGER NOT NULL,
  author_id TEXT NOT NULL, author_name TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','expired'))
);
CREATE INDEX kw_tag_queue ON kw_tag_proposals(state,expires_at);
CREATE UNIQUE INDEX kw_tag_open ON kw_tag_proposals(category_id) WHERE state='pending';
CREATE TABLE kw_tag_votes(
  proposal_id TEXT NOT NULL REFERENCES kw_tag_proposals(id), membership_id TEXT NOT NULL,
  actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(proposal_id,membership_id), UNIQUE(proposal_id,actor_id)
);
-- Only the three named demonstration terms in the shared vocabulary, with no adopted usage.
INSERT INTO kw_tag_proposals(id,category_id,name,definition,base_version,author_id,author_name,created_at,expires_at)
SELECT CASE c.name
  WHEN '工程' THEN '1f6550f4-efce-4a78-8c4e-21f162b90a15'
  WHEN '技击技术' THEN '322fc86e-c129-46bb-a868-849de37929c5'
  WHEN '运动' THEN 'c82928aa-ca71-474a-99a0-240ae8abfe68' END,
  c.id,c.name,c.definition,c.version,'system','系统',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 days')
FROM kw_categories c
WHERE c.name IN ('工程','技击技术','运动')
AND (c.independent=1 OR EXISTS(SELECT 1 FROM kw_items i JOIN kw_branches b ON b.id=i.branch_id
 JOIN kw_document_tags t ON t.version_id=i.version_id WHERE t.category_id=c.id AND b.visibility='members' AND b.state='open'))
AND NOT EXISTS(SELECT 1 FROM kw_items i JOIN kw_versions v ON v.id=i.version_id JOIN kw_document_tags t ON t.version_id=v.id
 WHERE i.branch_id='main' AND v.deleted=0 AND t.category_id=c.id);
UPDATE kw_categories SET pending=1,independent=1 WHERE id IN (SELECT category_id FROM kw_tag_proposals);

-- Implicit terms confined to private drafts keep their scope and do not become shared proposals.
UPDATE kw_categories SET pending=1
WHERE independent=0 AND NOT EXISTS (
 SELECT 1 FROM kw_document_tags t JOIN kw_items i ON i.version_id=t.version_id
 JOIN kw_branches b ON b.id=i.branch_id WHERE t.category_id=kw_categories.id AND b.visibility='members'
) AND NOT EXISTS (
 SELECT 1 FROM kw_document_tags t JOIN kw_changes ch ON ch.after_id=t.version_id
 JOIN kw_commits co ON co.id=ch.commit_id JOIN kw_branches b ON b.id=co.branch_id
 WHERE t.category_id=kw_categories.id AND b.visibility='members'
);
