import { KnowledgeError, uid } from "../types.ts";
import type { KnowledgeBranch } from "../../../app/shared/knowledge.ts";
import type { ServiceContext } from './context.ts';
import { runCommand } from './command.ts';
import { getBranch, assertEditable, getVersion, prepareCommit } from './records.ts';
import { branchDiff } from './documents.ts';
import { expected_version, branch_id, workspaceSchemas } from './inputs.ts';
export async function listBranches(context: ServiceContext) {
  const rows = await context.stmt("SELECT * FROM kw_branches WHERE state<>'closed' AND (?=0 OR id='main') AND (visibility='members' OR owner_id=?) ORDER BY CASE WHEN id='main' THEN 0 ELSE 1 END,updated_at DESC,id", context.guest ? 1 : 0, context.actor.id).all<KnowledgeBranch>();
  return {
    branches: rows.results,
    identity: context.identity
  };
}
export async function createBranch(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.branch.parse(input);
  return runCommand(context, a, 'branch.create', async at => {
    const main = await getBranch(context, 'main'),
      id = uid();
    return {
      statements: [context.stmt('INSERT INTO kw_branches(id,name,owner_id,owner_name,visibility,head_id,base_head_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', id, a.name, context.actor.id, context.actor.name, a.visibility, main.head_id, main.head_id, at, at), context.stmt('INSERT INTO kw_items SELECT ?,document_id,version_id,version_id FROM kw_items WHERE branch_id=?', id, 'main')],
      result: {
        id,
        version: 1
      }
    };
  });
}
export async function shareBranch(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.share.parse(input);
  return runCommand(context, a, 'branch.share', async at => {
    const b = await getBranch(context, a.branch_id);
    assertEditable(context, b, a.expected_version);
    if (b.owner_id !== context.actor.id) throw new KnowledgeError(403, 'OWNER_REQUIRED', '仅作者可以公开私人草稿');
    return {
      statements: [context.stmt("UPDATE kw_branches SET visibility='members',version=version+1,updated_at=? WHERE id=?", at, b.id)],
      result: {
        id: b.id,
        version: b.version + 1
      }
    };
  });
}
export async function deleteBranch(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.deleteBranch.parse(input);
  return runCommand(context, a, 'branch.delete', async at => {
    const b = await getBranch(context, a.branch_id);
    if (b.id === 'main') throw new KnowledgeError(403, 'MAIN_PROTECTED', '主分支不能删除');
    if (b.owner_id !== context.actor.id) throw new KnowledgeError(403, 'OWNER_REQUIRED', '仅分支创建者可以删除分支');
    if (b.version !== a.expected_version) throw new KnowledgeError(409, 'CONFLICT', '分支已变化，请刷新后核对');
    return {
      statements: [context.stmt("UPDATE kw_branches SET state='closed',version=version+1,updated_at=? WHERE id=?", at, b.id), context.stmt("UPDATE kw_merges SET state='closed',version=version+1,updated_at=? WHERE branch_id=? AND state='open'", at, b.id)],
      result: {
        id: b.id,
        name: b.name,
        version: b.version + 1,
        deleted: true
      }
    };
  });
}
export async function branchHistory(context: ServiceContext, branchId: string, offset = 0) {
  await getBranch(context, branchId);
  const rows = await context.stmt('WITH RECURSIVE ancestry(id) AS (SELECT head_id FROM kw_branches WHERE id=? UNION SELECT c.parent_id FROM kw_commits c JOIN ancestry a ON c.id=a.id WHERE c.parent_id IS NOT NULL UNION SELECT c.merge_parent_id FROM kw_commits c JOIN ancestry a ON c.id=a.id WHERE c.merge_parent_id IS NOT NULL) SELECT c.* FROM kw_commits c JOIN ancestry a ON a.id=c.id WHERE (?=0 OR c.branch_id=\'main\') ORDER BY c.created_at DESC,c.id DESC LIMIT 51 OFFSET ?', branchId, context.guest ? 1 : 0, offset).all();
  return {
    commits: rows.results.slice(0, 50),
    next_offset: rows.results.length > 50 ? offset + 50 : null
  };
}
export async function commitDetail(context: ServiceContext, branchId: string, id: string) {
  await getBranch(context, branchId);
  const reachable = await context.stmt('WITH RECURSIVE ancestry(id) AS (SELECT head_id FROM kw_branches WHERE id=? UNION SELECT c.parent_id FROM kw_commits c JOIN ancestry a ON a.id=c.id WHERE c.parent_id IS NOT NULL UNION SELECT c.merge_parent_id FROM kw_commits c JOIN ancestry a ON a.id=c.id WHERE c.merge_parent_id IS NOT NULL) SELECT id FROM ancestry WHERE id=?', branchId, id).first();
  if (!reachable || context.guest && !(await context.stmt("SELECT id FROM kw_commits WHERE id=? AND branch_id='main'", id).first())) throw new KnowledgeError(404, 'NOT_FOUND', '版本不存在或不可见');
  const commit = await context.stmt('SELECT * FROM kw_commits WHERE id=?', id).first();
  const rows = (await context.stmt('SELECT * FROM kw_changes WHERE commit_id=?', id).all<{
    document_id: string;
    before_id: string | null;
    after_id: string;
  }>()).results;
  const changes = [];
  for (const row of rows) changes.push({
    document_id: row.document_id,
    before: await getVersion(context, row.before_id),
    after: await getVersion(context, row.after_id)
  });
  return {
    commit,
    changes
  };
}
export async function resolveConflict(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.resolve.parse(input);
  return runCommand(context, a, 'branch.resolve', async at => {
    const {
      branch,
      main,
      changes
    } = await branchDiff(context, a.branch_id);
    assertEditable(context, branch, a.expected_version);
    if (main.version !== a.main_version) throw new KnowledgeError(409, 'MAIN_CHANGED', '主分支已变化');
    const change = changes.find(c => c.document_id === a.document_id);
    if (!change?.conflict) throw new KnowledgeError(409, 'NO_CONFLICT', '该条目当前没有冲突');
    const version = a.choice === 'main' ? change.current?.id : change.proposed.id;
    if (!version) throw new KnowledgeError(400, 'INVALID_RESOLUTION', '请选择保留分支版本');
    const commit = uid();
    return {
      statements: [prepareCommit(context, commit, branch, '解决冲突：' + change.proposed.title, at), context.stmt('INSERT INTO kw_changes VALUES(?,?,?,?)', commit, a.document_id, change.proposed.id, version), context.stmt('UPDATE kw_items SET base_version_id=?,version_id=? WHERE branch_id=? AND document_id=?', change.current?.id ?? null, version, branch.id, a.document_id), context.stmt('UPDATE kw_branches SET head_id=?,version=version+1,updated_at=? WHERE id=?', commit, at, branch.id)],
      result: {
        id: branch.id,
        version: branch.version + 1,
        head_id: commit
      }
    };
  });
}
