import { canonical, KnowledgeError, uid } from "../types.ts";
import type { KnowledgeBranch, KnowledgeMerge, KnowledgeDiff } from "../../../app/shared/knowledge.ts";
import type { ServiceContext } from './context.ts';
import { runCommand } from './command.ts';
import { getBranch, assertEditable, getDocument, prepareCommit } from './records.ts';
import { branchDiff } from './documents.ts';
import { getMergeRequest, qualifiedMerges } from './review-queries.ts';
import { getIssue } from './issue-queries.ts';
import { expected_version, branch_id, workspaceSchemas } from './inputs.ts';
export async function submitReview(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.review.parse(input);
  return runCommand(context, a, 'review.submit', async at => {
    const source = await getBranch(context, a.branch_id);
    assertEditable(context, source, a.expected_version);
    const document = await getDocument(context, source.id, a.document_id);
    if (document.id !== a.version_id) throw new KnowledgeError(409, 'CONFLICT', '草稿内容已变化，请重新核对');
    const existing = await context.stmt('SELECT m.id,m.branch_id,m.head_id,m.state FROM kw_review_sources s JOIN kw_merges m ON m.id=s.merge_id WHERE s.source_branch_id=? AND s.document_id=? AND s.source_version_id=? AND m.state<>\'closed\'', source.id, document.document_id, document.id).first<Record<string, unknown>>();
    if (existing) return {
      statements: [],
      result: {
        ...existing,
        document_id: document.document_id
      }
    };
    const main = await getBranch(context, 'main'),
      base = await context.stmt('SELECT base_version_id FROM kw_items WHERE branch_id=? AND document_id=?', source.id, document.document_id).first<{
        base_version_id: string | null;
      }>();
    if (base?.base_version_id === document.id) throw new KnowledgeError(400, 'NO_CHANGES', '这篇文档没有待审核的修改');
    const branchId = uid(),
      commitId = uid(),
      mergeId = uid(),
      reason = a.reason || '提交审核';
    return {
      statements: [context.stmt('INSERT INTO kw_branches(id,name,owner_id,owner_name,visibility,head_id,base_head_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', branchId, document.title.slice(0, 55) + ' · ' + branchId.slice(0, 8), context.actor.id, context.actor.name, 'members', commitId, main.head_id, at, at), context.stmt("INSERT INTO kw_items SELECT ?,document_id,version_id,version_id FROM kw_items WHERE branch_id='main'", branchId), context.stmt('INSERT INTO kw_items VALUES(?,?,?,?) ON CONFLICT(branch_id,document_id) DO UPDATE SET version_id=excluded.version_id,base_version_id=excluded.base_version_id', branchId, document.document_id, document.id, base?.base_version_id ?? null), context.stmt('INSERT INTO kw_commits VALUES(?,?,?,?,?,?,?,?)', commitId, branchId, main.head_id, null, reason, context.actor.id, context.actor.name, at), context.stmt('INSERT INTO kw_changes VALUES(?,?,?,?)', commitId, document.document_id, base?.base_version_id ?? null, document.id), context.stmt('INSERT INTO kw_merges(id,branch_id,head_id,title,reason,author_id,author_name,created_at,updated_at,auto_promote) VALUES(?,?,?,?,?,?,?,?,?,1)', mergeId, branchId, commitId, document.title, reason, context.actor.id, context.actor.name, at, at), context.stmt('INSERT INTO kw_review_sources VALUES(?,?,?,?) ON CONFLICT(source_branch_id,document_id,source_version_id) DO UPDATE SET merge_id=excluded.merge_id', source.id, document.document_id, document.id, mergeId)],
      result: {
        id: mergeId,
        branch_id: branchId,
        head_id: commitId,
        document_id: document.document_id,
        state: 'open'
      }
    };
  });
}
export async function proposeMerge(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.merge.parse(input);
  return runCommand(context, a, 'merge.propose', async at => {
    const diff = await branchDiff(context, a.branch_id),
      b = diff.branch;
    assertEditable(context, b, a.expected_version);
    if (b.visibility !== 'members') throw new KnowledgeError(409, 'PRIVATE_BRANCH', '请先明确共享该分支，再征求成员同意');
    if (!b.head_id || !diff.changes.length) throw new KnowledgeError(400, 'NO_CHANGES', '此分支没有需要合入的修改');
    const old = await context.stmt("SELECT * FROM kw_merges WHERE branch_id=? AND state='open'", b.id).first<KnowledgeMerge>(),
      id = old?.id ?? uid();
    return {
      statements: [old ? context.stmt('UPDATE kw_merges SET head_id=?,title=?,reason=?,version=version+1,updated_at=? WHERE id=?', b.head_id, a.title, a.reason, at, id) : context.stmt('INSERT INTO kw_merges(id,branch_id,head_id,title,reason,author_id,author_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', id, b.id, b.head_id, a.title, a.reason, context.actor.id, context.actor.name, at, at)],
      result: {
        id,
        head_id: b.head_id
      }
    };
  });
}
export async function approveMerge(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.approve.parse(input);
  return runCommand(context, a, 'merge.approve', async at => {
    const m = await getMergeRequest(context, a.id);
    if (m.state !== 'open' || m.head_id !== m.current_head_id || a.head_id !== m.head_id) throw new KnowledgeError(409, 'STALE_PROPOSAL', '修改版本已变化，请先阅读最新合并请求');
    const actor = context.actor;
    if ('kind' in actor || !actor.membership_id) throw new KnowledgeError(403, 'FORMAL_MEMBER_REQUIRED', '需要当前正式成员身份');
    const statements = [context.stmt('INSERT OR IGNORE INTO kw_approvals VALUES(?,?,?,?,?,?,?)', m.id, m.head_id, actor.id, actor.name, actor.membership_id, actor.verified_at, at)],
      count = m.approval_count + (m.approved_by_me ? 0 : 1);
    let pending: string | null = null;
    if (m.auto_promote && count >= 3) {
      const diff = await branchDiff(context, m.branch_id),
        others = (await qualifiedMerges(context)).filter(x => x.id !== m.id),
        ids = JSON.stringify(diff.changes.map(c => c.document_id));
      // Keep concurrent alternatives open even while their voting is still in progress.
      const competing = await context.stmt("SELECT 1 FROM kw_merges x JOIN kw_branches b ON b.id=x.branch_id JOIN kw_items i ON i.branch_id=b.id WHERE x.id<>? AND x.state='open' AND x.head_id=b.head_id AND i.version_id IS NOT i.base_version_id AND i.document_id IN (SELECT value FROM json_each(?)) LIMIT 1", m.id, ids).first();
      if (others.length || competing) pending = 'choice';else if (diff.changes.some(c => c.conflict)) pending = 'conflict';else if (!diff.changes.length) pending = 'no_changes';else {
        const merged = mergeChanges(context, m, at, null, diff);
        return {
          statements: [...statements, ...merged.statements],
          result: {
            ...merged.result,
            head_id: m.head_id,
            agreed: true,
            approval_count: count,
            merged: true
          }
        };
      }
    }
    return {
      statements,
      result: {
        id: m.id,
        head_id: m.head_id,
        agreed: true,
        approval_count: count,
        merged: false,
        pending
      }
    };
  });
}
export async function acceptMerge(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.accept.parse(input);
  return runCommand(context, a, 'merge.accept', async at => {
    const m = await getMergeRequest(context, a.id),
      qualified = await qualifiedMerges(context);
    if (m.state !== 'open' || m.head_id !== m.current_head_id || a.head_id !== m.head_id) throw new KnowledgeError(409, 'STALE_PROPOSAL', '修改版本已变化，请重新确认');
    if (!qualified.some(x => x.id === m.id)) throw new KnowledgeError(403, 'THREE_APPROVALS_REQUIRED', '需要至少三名不同正式成员同意当前修改版本');
    const candidates = qualified.map(x => ({
      id: x.id,
      head_id: x.head_id
    })).sort((x, y) => x.id.localeCompare(y.id));
    let selection: unknown = null;
    if (qualified.length > 1 && !a.selection) throw new KnowledgeError(409, 'CONSENSUS_CHOICE_REQUIRED', '多个候选均已达标，请通过会议或议题记录选择结论');
    if (a.selection?.kind === 'issue') {
      const issue = await getIssue(context, a.selection.issue_id);
      if (issue.state !== 'closed' || issue.selected_merge_id !== m.id || canonical(JSON.parse(issue.candidates_json ?? '[]')) !== canonical(candidates)) throw new KnowledgeError(409, 'CHOICE_STALE', '议题尚未确定该候选，或达标候选已变化');
      selection = {
        kind: 'issue',
        issue_id: issue.id,
        resolution: issue.resolution,
        candidates
      };
    } else if (a.selection) selection = {
      ...a.selection,
      candidates
    };
    const {
      branch,
      main,
      changes
    } = await branchDiff(context, m.branch_id);
    if (main.version !== a.main_version) throw new KnowledgeError(409, 'MAIN_CHANGED', '主分支已变化，请重新比较');
    if (changes.some(c => c.conflict)) throw new KnowledgeError(409, 'MERGE_CONFLICT', '存在内容冲突，请先在分支中解决并重新征求同意');
    if (!changes.length) throw new KnowledgeError(409, 'NO_CHANGES', '没有需要合入的内容');
    return mergeChanges(context, m, at, selection, {
      branch,
      main,
      changes
    });
  });
}
export function mergeChanges(context: ServiceContext, m: KnowledgeMerge, at: string, selection: unknown, {
  branch,
  main,
  changes
}: {
  branch: KnowledgeBranch;
  main: KnowledgeBranch;
  changes: KnowledgeDiff[];
}) {
  const commit = uid(),
    ids = JSON.stringify(changes.map(c => c.document_id));
  return {
    statements: [prepareCommit(context, commit, main, '合入：' + m.title, at, branch.head_id), context.stmt('INSERT INTO kw_changes SELECT ?,i.document_id,m.version_id,i.version_id FROM kw_items i LEFT JOIN kw_items m ON m.branch_id=\'main\' AND m.document_id=i.document_id WHERE i.branch_id=? AND i.document_id IN (SELECT value FROM json_each(?))', commit, branch.id, ids), context.stmt('INSERT INTO kw_items(branch_id,document_id,version_id) SELECT \'main\',document_id,version_id FROM kw_items WHERE branch_id=? AND document_id IN (SELECT value FROM json_each(?)) ON CONFLICT(branch_id,document_id) DO UPDATE SET version_id=excluded.version_id', branch.id, ids), context.stmt('UPDATE kw_branches SET head_id=?,version=version+1,updated_at=? WHERE id=\'main\'', commit, at), context.stmt("UPDATE kw_branches SET state='merged',version=version+1,updated_at=? WHERE id=?", at, branch.id), context.stmt("UPDATE kw_merges SET state='merged',version=version+1,updated_at=?,merged_at=?,selection_json=? WHERE id=?", at, at, selection ? JSON.stringify(selection) : null, m.id)],
    result: {
      id: m.id,
      commit_id: commit,
      branch_id: branch.id,
      main_version: main.version + 1,
      selection
    }
  };
}
