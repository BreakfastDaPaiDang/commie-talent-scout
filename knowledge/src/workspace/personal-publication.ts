import type { KnowledgeBranch, KnowledgeVersion } from '../../../app/shared/knowledge.ts';
import { uid } from '../types.ts';
import type { ServiceContext } from './context.ts';
import { prepareCommit } from './records.ts';
import { matchingReviewSubmission, reviewVisible, singleDocumentBranch } from './review-queries.ts';

export async function canPublishPersonalDocument(context: ServiceContext, branchId: string, document: KnowledgeVersion, at = context.clock()) {
  const member = context.identity;
  if (branchId === 'main' || !member.can_write || !member.membership_id || document.deleted) return false;
  const owner = 'personal:' + member.membership_id;
  if (document.scopes?.length !== 1 || document.scopes[0] !== owner) return false;

  // Existing reviews and shared or removed main versions follow the approval path.
  const item = await context.stmt(`SELECT draft.base_version_id, current.version_id AS current_id,
    EXISTS(SELECT 1 FROM kw_versions v JOIN kw_version_scopes owned ON owned.version_id=v.id
      WHERE v.id=current.version_id AND v.deleted=0 AND owned.scope_id=?
        AND (SELECT COUNT(*) FROM kw_version_scopes s WHERE s.version_id=v.id)=1) AS can_revise
    FROM kw_items draft JOIN kw_branches b ON b.id=draft.branch_id AND b.state='open'
    LEFT JOIN kw_items current ON current.branch_id='main' AND current.document_id=draft.document_id
    WHERE draft.branch_id=? AND draft.document_id=? AND draft.version_id=?
      AND draft.version_id IS NOT draft.base_version_id
      AND NOT EXISTS(SELECT 1 ${matchingReviewSubmission})
      AND NOT EXISTS(SELECT 1 FROM kw_merges m WHERE m.branch_id=b.id AND m.state='open' AND m.head_id=b.head_id
        AND ${singleDocumentBranch} AND ${reviewVisible})`,
    owner, branchId, document.document_id, document.id, branchId, document.document_id, document.id, at, at)
    .first<{base_version_id: string | null; current_id: string | null; can_revise: number}>();
  return !!item && item.base_version_id === item.current_id && (!item.current_id || item.can_revise === 1);
}

function publicationResult(documentId: string, versionId: string, commitId: string, mainVersion: number) {
  return {
    id: commitId, branch_id: 'main', head_id: commitId, commit_id: commitId, main_version: mainVersion,
    document_id: documentId, version_id: versionId, state: 'merged', published_directly: true, expires_at: null,
  } as const;
}

export async function findPersonalPublication(context: ServiceContext, branchId: string, documentId: string, versionId: string) {
  const record = await context.stmt(`SELECT p.commit_id,p.main_version FROM kw_personal_publications p
    JOIN kw_versions v ON v.id=p.version_id WHERE p.source_branch_id=? AND p.version_id=? AND v.document_id=?`,
    branchId, versionId, documentId).first<{commit_id: string; main_version: number}>();
  return record ? publicationResult(documentId, versionId, record.commit_id, record.main_version) : null;
}

export function publishPersonalDocument(context: ServiceContext, {
  source, main, document, baseVersionId, message, at,
}: {
  source: KnowledgeBranch;
  main: KnowledgeBranch;
  document: KnowledgeVersion;
  baseVersionId: string | null;
  message: string;
  at: string;
}) {
  const commitId = uid();
  const mainVersion = main.version + 1;
  return {
    statements: [
      // A published commit must not expose the source branch's private history.
      prepareCommit(context, commitId, main, message, at),
      context.stmt('INSERT INTO kw_changes VALUES(?,?,?,?)', commitId, document.document_id, baseVersionId, document.id),
      context.stmt(`INSERT INTO kw_items(branch_id,document_id,version_id) VALUES('main',?,?)
        ON CONFLICT(branch_id,document_id) DO UPDATE SET version_id=excluded.version_id`, document.document_id, document.id),
      context.stmt("UPDATE kw_branches SET head_id=?,version=version+1,updated_at=? WHERE id='main'", commitId, at),
      context.stmt('UPDATE kw_items SET base_version_id=? WHERE branch_id=? AND document_id=?', document.id, source.id, document.document_id),
      context.stmt('UPDATE kw_branches SET version=version+1,updated_at=? WHERE id=?', at, source.id),
      context.stmt('INSERT INTO kw_personal_publications VALUES(?,?,?,?)', source.id, document.id, commitId, mainVersion),
    ],
    result: publicationResult(document.document_id, document.id, commitId, mainVersion),
  };
}
