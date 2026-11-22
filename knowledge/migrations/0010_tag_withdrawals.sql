-- A closed ballot keeps its submitted text and votes; only the author edits the draft.
CREATE TABLE kw_tag_withdrawals (
  proposal_id TEXT PRIMARY KEY REFERENCES kw_tag_proposals(id),
  withdrawn_at TEXT NOT NULL,
  draft_name TEXT NOT NULL,
  draft_definition TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  resubmitted_id TEXT REFERENCES kw_tag_proposals(id)
);
