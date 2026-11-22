import { z } from 'zod';
import { isMemberArchive, memberBasicStates, storedMemberStatus } from '../rules/archive-states.ts';
import { Archives } from './archives.ts';
import { command, requestId, type Source } from './commands.ts';
import { initialObservation, occurredAt } from './observations.ts';
import { Failure, now, uid, type Actor, type Env } from './types.ts';

export const backfillMemberInput = z.object({
  name: z.string().trim().min(1).max(120),
  qq: z.string().trim().regex(/^\d{5,20}$/, 'QQ 使用 5–20 位数字'),
  basis: z.string().trim().min(1, '请填写原入社依据').max(100000),
  occurred_at: occurredAt.default(null),
  member_status: z.enum(memberBasicStates).default('可接工作'),
  request_id: requestId,
}).strict();

const matchesQQ = `FROM archives a WHERE a.type='person' AND EXISTS(
  SELECT 1 FROM json_each(a.contacts_json) c WHERE upper(trim(json_extract(c.value,'$.type')))='QQ'
  AND trim(json_extract(c.value,'$.value'))=?)`;
type Match = {id:string;name:string;status:string;person_role:'member'|'external'|null;version:number;closed:number;deleted:number};

export async function backfillMember(env: Env, actor: Actor, source: Source, input: unknown) {
  const a = backfillMemberInput.parse(input);
  const archives = new Archives(env,actor,source);
  const stmt = archives.stmt.bind(archives);
  return command(env,actor,{requestId:a.request_id,operation:'archive.backfill_member',parameters:a},async () => {
    const {results} = await stmt(`SELECT a.id,a.name,a.status,a.person_role,a.version,a.closed,a.deleted ${matchesQQ} LIMIT 2`,a.qq).all<Match>();
    const old = results[0];
    if (results.length > 1 || old && (old.closed || old.deleted || old.name !== a.name))
      throw new Failure(409,'BACKFILL_QQ_CONFLICT','已有档案使用这个 QQ，请先核对名称和档案状态。');
    const archiveGuard = uid();
    if (old && isMemberArchive({type:'person',...old})) {
      return {result:{id:old.id,version:old.version,observation_id:null as string|null,changed:false},statements:[archives.guard(old.id,old.version,archiveGuard),stmt('DELETE FROM mutation_guards WHERE id=?',archiveGuard)]};
    }
    if (old && (['人事审核','已加入待对接'].includes(old.status) || await stmt(`SELECT 1 FROM archive_events
      WHERE archive_id=? AND (json_extract(before_json,'$.status')='已入伙' OR json_extract(after_json,'$.status')='已入伙') LIMIT 1`,old.id).first()))
      throw new Failure(409,'BACKFILL_NOT_APPLICABLE','这份档案已有正式入社历史或正在审核、对接，请在原档案处理。');

    const id = old?.id ?? uid(), observationId = uid(), at = now(), guard = uid();
    const version = (old?.version ?? 1) + 1;
    const contacts = [{type:'QQ',value:a.qq,note:''}];
    const statements = [
      stmt(`INSERT INTO mutation_guards SELECT ?,CASE WHEN count(*)=? AND max(a.id) IS ? THEN 1 ELSE 0 END ${matchesQQ}`,
        guard,old ? 1 : 0,old?.id ?? null,a.qq),
    ];
    if (old) statements.push(archives.guard(id,old.version,archiveGuard));
    else statements.push(stmt(`INSERT INTO archives(id,type,name,contacts_json,status,person_role,created_by,created_at,updated_at)
      VALUES(?,'person',?,?,'视奸观察','external',?,?,?)`,id,a.name,JSON.stringify(contacts),actor.id,at,at));

    statements.push(
      ...initialObservation(archives,observationId,id,a.basis,a.occurred_at,at),
      stmt('INSERT INTO personnel_member_backfills(archive_id,target_version,observation_id,recorded_at) VALUES(?,?,?,?)',id,version,observationId,at),
      stmt(`UPDATE archives SET status='已入伙',person_role='member',member_status=?,member_work_paused=?,version=?,updated_at=? WHERE id=?`,
        storedMemberStatus(a.member_status),Number(a.member_status==='暂不接工作'),version,at,id),
      stmt("UPDATE personnel_recognition_rounds SET state='closed',ended_at=? WHERE archive_id=? AND state='collecting'",at,id),
      archives.event(id,old ? 'archive.state_changed' : 'archive.created',old ? {status:old.status} : null,
        {type:'person',name:a.name,status:'已入伙',person_role:'member',member_status:a.member_status,historical_backfill:true,observation_id:observationId},at),
      archives.event(id,'observation.created',null,{id:observationId,content_version:1},at,observationId),
      stmt('DELETE FROM mutation_guards WHERE id=?',guard),
    );
    if (old) statements.push(stmt('DELETE FROM mutation_guards WHERE id=?',archiveGuard));
    return {statements,result:{id,version,observation_id:observationId,changed:true}};
  });
}
