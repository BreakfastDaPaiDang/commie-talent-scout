import { z } from 'zod';
import { Archives } from './archives.ts';
import { command, requestId, type Source } from './commands.ts';
import { Failure, now, uid, type Actor, type Env } from './types.ts';
import { planArchiveEffects, preparePersonnelTask } from '../rules/archive-lifecycle.ts';
import { TagState } from './tag-state.ts';
export const recognitionReadInput = z.object({
  archive_id: z.uuid()
}).strict();
export const recognitionInput = z.object({
  archive_id: z.uuid(),
  round_number: z.number().int().positive(),
  observation_id: z.uuid(),
  content_version: z.number().int().positive(),
  request_id: requestId
}).strict();
export const recognitionWithdrawInput = z.object({
  id: z.uuid(),
  request_id: requestId
}).strict();
export function recognitionMonth(at: string) {
  return new Date(Date.parse(at) + 8 * 3600000).toISOString().slice(0, 7);
}
type Round = {
  id: string;
  number: number;
  state: 'collecting' | 'reviewing' | 'closed';
  task_id: string | null;
  legacy: number;
};
const eligibleSql = "SELECT a.id FROM archives a JOIN members m ON m.id=a.linked_account_id WHERE a.linked_account_id=? AND a.type='person' AND a.person_role='member' AND a.closed=0 AND a.deleted=0 AND m.frozen=0 AND m.identity_kind='human'";
export class PersonnelRecognition {
  constructor(readonly env: Env, readonly actor: Actor, readonly source: Source) {}
  stmt(sql: string, ...args: unknown[]) {
    return this.env.DB.prepare(sql).bind(...args);
  }
  async identity() {
    return this.stmt(eligibleSql, this.actor.id).first<{
      id: string;
    }>();
  }
  async round(id: string) {
    return this.stmt('SELECT * FROM personnel_recognition_rounds WHERE archive_id=? ORDER BY number DESC LIMIT 1', id).first<Round>();
  }
  async summary(input: unknown) {
    const a = recognitionReadInput.parse(input),
      archive = await new Archives(this.env, this.actor, this.source).get(a.archive_id);
    const [member, round] = await Promise.all([this.identity(), this.round(a.archive_id)]),
      month = recognitionMonth(now());
    const used = member ? await this.stmt('SELECT count(*) n FROM personnel_recognitions WHERE member_archive_id=? AND month=?', member.id, month).first<number>('n') : 0;
    const votes = round ? (await this.stmt(`SELECT v.id,v.member_archive_id,m.name,v.observation_id,v.content_version,v.created_at,v.withdrawn_at,o.deleted evidence_deleted FROM personnel_recognitions v JOIN archives m ON m.id=v.member_archive_id JOIN observations o ON o.id=v.observation_id WHERE v.round_id=? ORDER BY v.created_at,v.id`, round.id).all<{
      id: string;
      member_archive_id: string;
      name: string;
      observation_id: string;
      content_version: number;
      created_at: string;
      withdrawn_at: string | null;
      evidence_deleted: number;
    }>()).results : [];
    const mine = votes.find(v => v.member_archive_id === member?.id),
      active = votes.filter(v => !v.withdrawn_at && !v.evidence_deleted);
    const collecting = !round || round.state === 'closed' || round.state === 'collecting';
    const available = archive.type === 'person' && !archive.closed && !archive.deleted && !['人事审核', '已加入待对接', '已入伙'].includes(archive.status);
    return {
      archive_id: archive.id,
      archive_name: archive.name,
      month,
      quota: {
        limit: 2,
        used: used ?? 0,
        remaining: Math.max(0, 2 - (used ?? 0))
      },
      eligible: !!member,
      round,
      round_number: round ? round.state === 'closed' ? round.number + 1 : round.number : 1,
      count: round?.state === 'closed' ? 0 : active.length,
      required: 3,
      can_recognize: !!member && available && collecting && (used ?? 0) < 2 && (!mine || round?.state === 'closed'),
      mine: round?.state === 'closed' ? null : mine ?? null,
      votes,
      task_id: round?.task_id ?? null
    };
  }
  async recognize(input: unknown) {
    const a = recognitionInput.parse(input);
    return command(this.env, this.actor, {
      requestId: a.request_id,
      operation: 'personnel.recognize',
      parameters: a
    }, async () => {
      const member = await this.identity();
      if (!member) throw new Failure(403, 'FORMAL_MEMBER_REQUIRED', '仅绑定正式社员档案的有效个人账号可以认可，管理员遵循同一规则');
      const archives = new Archives(this.env, this.actor, this.source),
        archive = await archives.get(a.archive_id, undefined, true);
      if (archive.type !== 'person' || ['人事审核', '已加入待对接', '已入伙'].includes(archive.status)) throw new Failure(409, 'PERSONNEL_STAGE_CHANGED', '该人物已进入审核或已加入，请查看现有任务');
      if (member.id === archive.id) throw new Failure(403, 'SELF_RECOGNITION', '不能认可自己');
      const previous = await this.round(a.archive_id),
        number = previous ? previous.state === 'closed' ? previous.number + 1 : previous.number : 1;
      if (number !== a.round_number || previous?.state === 'reviewing') throw new Failure(409, 'ROUND_CHANGED', '审核轮次已变化，请重新读取后确认');
      const existing = previous?.state === 'collecting' ? previous : null,
        roundId = existing?.id ?? uid();
      if (existing && (await this.stmt('SELECT 1 FROM personnel_recognitions WHERE round_id=? AND member_archive_id=?', roundId, member.id).first())) throw new Failure(409, 'ALREADY_RECOGNIZED', '本轮已认可过该人物，撤回后也不能重复占用名额');
      const evidence = await this.stmt('SELECT 1 FROM observations WHERE id=? AND archive_id=? AND content_version=? AND deleted=0', a.observation_id, a.archive_id, a.content_version).first();
      if (!evidence) throw new Failure(409, 'EVIDENCE_CHANGED', '观察已更新、删除或不属于此人，请重新阅读当前版本');
      const at = now(),
        month = recognitionMonth(at),
        slots = (await this.stmt('SELECT slot FROM personnel_recognitions WHERE member_archive_id=? AND month=?', member.id, month).all<{
          slot: number;
        }>()).results;
      const slot = [1, 2].find(n => !slots.some(s => s.slot === n));
      if (!slot) throw new Failure(409, 'MONTHLY_QUOTA_EXHAUSTED', '本月两份人员认可已用完，撤回不退还额度');
      const count = existing ? (await this.stmt('SELECT count(*) n FROM personnel_recognitions v JOIN observations o ON o.id=v.observation_id WHERE v.round_id=? AND v.withdrawn_at IS NULL AND o.deleted=0', roundId).first<number>('n')) ?? 0 : 0;
      const trigger = count + 1 >= 3,
        id = uid(),
        key = uid(),
        task = trigger ? await preparePersonnelTask(this.stmt.bind(this), archive.id, '人事审核', new Date(Date.parse(at) + 7 * 86400000).toISOString()) : null;
      const statements = [archives.guard(archive.id, archive.version, key), this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(${eligibleSql} AND a.id=?) AND EXISTS(SELECT 1 FROM observations WHERE id=? AND archive_id=? AND content_version=? AND deleted=0) THEN 1 ELSE 0 END)`, key + ':eligibility', this.actor.id, member.id, a.observation_id, a.archive_id, a.content_version)];
      if (!existing) statements.push(this.stmt("INSERT INTO personnel_recognition_rounds(id,archive_id,number,state,created_at) VALUES(?,?,?,'collecting',?)", roundId, archive.id, number, at));
      statements.push(this.stmt('INSERT INTO personnel_recognitions(id,round_id,member_archive_id,account_id,observation_id,content_version,month,slot,created_at) VALUES(?,?,?,?,?,?,?,?,?)', id, roundId, member.id, this.actor.id, a.observation_id, a.content_version, month, slot, at));
      if (trigger && task) {
        // Set reviewing before archive effects; task FK is attached after task insertion.
        statements.push(this.stmt("UPDATE personnel_recognition_rounds SET state='reviewing' WHERE id=?", roundId));
        statements.push(...planArchiveEffects({
          old: archive,
          status: '人事审核',
          memberIds: [],
          reopen: false,
          stageTask: task,
          at,
          actorId: this.actor.id,
          source: this.source,
          members: [],
          bindings: [],
          tags: new TagState(this.env, this.actor),
          stmt: this.stmt.bind(this),
          event: archives.event.bind(archives)
        }));
        statements.push(this.stmt('UPDATE personnel_recognition_rounds SET task_id=? WHERE id=?', task.id, roundId));
      } else statements.push(this.stmt('UPDATE archives SET version=version+1 WHERE id=?', archive.id));
      statements.push(archives.event(archive.id, 'personnel.recognized', null, {
        recognition_id: id,
        round_number: number,
        member_archive_id: member.id,
        content_version: a.content_version,
        count: count + 1,
        task_id: task?.id ?? null
      }, at, a.observation_id), this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)', key, key + ':eligibility'));
      return {
        statements,
        result: {
          id,
          archive_id: archive.id,
          round_number: number,
          count: count + 1,
          task_id: task?.id ?? null,
          quota_remaining: 2 - slots.length - 1,
          triggered: trigger
        }
      };
    });
  }
  async withdraw(input: unknown) {
    const a = recognitionWithdrawInput.parse(input);
    return command(this.env, this.actor, {
      requestId: a.request_id,
      operation: 'personnel.withdraw',
      parameters: a
    }, async () => {
      const member = await this.identity();
      if (!member) throw new Failure(403, 'FORMAL_MEMBER_REQUIRED', '需要有效的正式社员账号');
      const v = await this.stmt('SELECT v.*,r.archive_id,r.task_id,r.state FROM personnel_recognitions v JOIN personnel_recognition_rounds r ON r.id=v.round_id WHERE v.id=?', a.id).first<{
        member_archive_id: string;
        archive_id: string;
        task_id: string | null;
        state: string;
        withdrawn_at: string | null;
        observation_id: string;
      }>();
      if (!v || v.member_archive_id !== member.id) throw new Failure(403, 'RECOGNITION_OWNER_REQUIRED', '只能撤回本人认可');
      if (v.withdrawn_at) return {
        statements: [],
        result: {
          id: a.id,
          changed: false,
          task_id: v.task_id,
          quota_refunded: false
        }
      };
      const archives = new Archives(this.env, this.actor, this.source),
        archive = await archives.get(v.archive_id),
        key = uid(),
        at = now();
      if (archive.deleted) throw new Failure(409, 'ARCHIVE_DELETED', '档案已删除，认可仅保留历史');
      const statements = [archives.guard(archive.id, archive.version, key, false), this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(${eligibleSql} AND a.id=?) THEN 1 ELSE 0 END)`, key + ':eligibility', this.actor.id, member.id), this.stmt('UPDATE personnel_recognitions SET withdrawn_at=? WHERE id=?', at, a.id), this.stmt('UPDATE archives SET version=version+1 WHERE id=?', archive.id), archives.event(archive.id, 'personnel.recognition_withdrawn', null, {
        recognition_id: a.id,
        task_id: v.task_id
      }, at, v.observation_id)];
      if (v.task_id) {
        statements.push(this.stmt("INSERT INTO work_task_events(id,task_id,actor_id,source,kind,after_json,reason,created_at) VALUES(?,?,?,?,'task.recognition_withdrawn',?,'认可已撤回，请重新核对依据；审核任务保留',?)", uid(), v.task_id, this.actor.id, this.source, JSON.stringify({
          recognition_id: a.id
        }), at));
        statements.push(this.stmt("INSERT INTO messages(id,recipient_id,kind,task_id,object_type,object_id,title,body,task_version,deadline_at,created_at) SELECT ?,owner_id,'personnel_recognition_withdrawn',id,'work_task',id,'人员认可已撤回','请核对审核依据，任务仍然保留',version,deadline_at,? FROM work_tasks WHERE id=? AND owner_id IS NOT NULL ON CONFLICT(recipient_id,kind,object_type,object_id,deadline_at) DO UPDATE SET read_at=NULL,created_at=excluded.created_at", uid(), at, v.task_id));
      }
      statements.push(this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)', key, key + ':eligibility'));
      return {
        statements,
        result: {
          id: a.id,
          changed: true,
          task_id: v.task_id,
          quota_refunded: false
        }
      };
    });
  }
}
