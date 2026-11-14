import { canonical, hash, KnowledgeError, uid } from "../types.ts";
import type { ServiceContext } from './context.ts';
import { assertWriter } from './records.ts';
import { request_id } from './inputs.ts';
export async function findReceipt(context: ServiceContext, id: string, fingerprint?: string) {
  const row = await context.stmt('SELECT fingerprint,result_json FROM kw_requests WHERE actor_id=? AND request_id=?', context.actor.id, id).first<{
    fingerprint: string;
    result_json: string;
  }>();
  if (row && fingerprint && row.fingerprint !== fingerprint) throw new KnowledgeError(409, 'REQUEST_REUSED', '请求编号已用于其他内容');
  return row ? JSON.parse(row.result_json) : null;
}
export async function runCommand(context: ServiceContext, input: {
  request_id: string;
}, operation: string, build: (at: string) => Promise<{
  statements: D1PreparedStatement[];
  result: Record<string, unknown>;
}>) {
  assertWriter(context);
  const fingerprint = await hash(canonical({
      operation,
      ...input
    })),
    saved = await findReceipt(context, input.request_id, fingerprint);
  if (saved) return saved;
  const revision = (await context.db.prepare('SELECT revision FROM kw_meta WHERE id=1').first<{
      revision: number;
    }>())!.revision,
    at = context.clock();
  const {
      statements,
      result
    } = await build(at),
    guard = uid();
  try {
    await context.db.batch([context.stmt('INSERT INTO kw_guards VALUES(?,CASE WHEN (SELECT revision FROM kw_meta WHERE id=1)=? THEN 1 ELSE 0 END)', guard, revision), ...statements, context.stmt('UPDATE kw_meta SET revision=revision+1 WHERE id=1'), context.stmt('INSERT INTO kw_events(actor_id,action,detail_json,created_at) VALUES(?,?,?,?)', context.actor.id, operation, JSON.stringify(result), at), context.stmt('INSERT INTO kw_requests VALUES(?,?,?,?,?)', context.actor.id, input.request_id, fingerprint, JSON.stringify(result), at), context.stmt('DELETE FROM kw_guards WHERE id=?', guard)]);
  } catch (error) {
    const committed = await findReceipt(context, input.request_id, fingerprint);
    if (committed) return committed;
    if (/constraint|immutable/i.test(String(error))) throw new KnowledgeError(409, 'CONFLICT', '内容已变化，请刷新核对后重试');
    throw error;
  }
  return result;
}
