-- Versions without explicit ranges, including records from older writers, belong to HR.
CREATE TABLE kw_version_scopes (
  version_id TEXT NOT NULL REFERENCES kw_versions(id),
  scope_id TEXT NOT NULL,
  scope_name TEXT,
  PRIMARY KEY(version_id, scope_id),
  CHECK((scope_id IN ('org','hr') AND scope_name IS NULL)
    OR (substr(scope_id,1,9)='personal:' AND length(scope_id)=45 AND scope_name IS NOT NULL AND length(trim(scope_name))>0))
);
CREATE INDEX kw_scopes_by_id ON kw_version_scopes(scope_id, version_id);
CREATE UNIQUE INDEX kw_one_personal_scope ON kw_version_scopes(version_id) WHERE substr(scope_id,1,9)='personal:';
CREATE TRIGGER kw_scope_immutable BEFORE UPDATE ON kw_version_scopes BEGIN SELECT RAISE(ABORT,'Knowledge version scopes are immutable'); END;
CREATE TRIGGER kw_scope_keep BEFORE DELETE ON kw_version_scopes BEGIN SELECT RAISE(ABORT,'Knowledge version scopes must be retained'); END;

CREATE TABLE kw_personal_publications (
  source_branch_id TEXT NOT NULL REFERENCES kw_branches(id),
  version_id TEXT NOT NULL REFERENCES kw_versions(id),
  commit_id TEXT NOT NULL UNIQUE REFERENCES kw_commits(id),
  main_version INTEGER NOT NULL CHECK(main_version>1),
  PRIMARY KEY(source_branch_id, version_id)
);
