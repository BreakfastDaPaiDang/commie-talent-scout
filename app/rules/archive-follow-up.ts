import {zaojiSubject} from './service-subjects.ts';
import {archiveReminder,DAY_MS} from './archive-reminders.ts';
import {planRules,type RuleModule} from './contract.ts';

export const archiveFollowUpRule='archive.follow_up';
export type FollowUpTarget={id:string;type:'person'|'org';name:string;status:string;person_role:'external'|'member'|null;closed:boolean;deleted:boolean;updated_at:string;version:number};
type Context={target:FollowUpTarget;at:string;taskId:string;eventId:string;stmt:(sql:string,...args:unknown[])=>D1PreparedStatement};
export function needsArchiveFollowUp(c:Context){return archiveReminder(c.target,Date.parse(c.at)).overdue;}
export function createArchiveFollowUp(c:Context){
 const {target:t,at,taskId}=c,deadline=new Date(Date.parse(at)+7*DAY_MS).toISOString();
 const title='接触跟进或关闭档案',purpose='核对近期情况与继续跟进的必要性，尝试联系或收集新的有效信息。',delivery='将实际接触结果、联系不到的情况或新的有效资料写入关联档案的观察记录；若决定不再跟进，说明原因并关闭档案，再提交任务交付。不要为消除提醒制造空更新。';
 return [
  c.stmt(`INSERT OR IGNORE INTO work_tasks(id,archive_id,kind,labels_json,priority,initiator_kind,initiator_id,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at,automation_rule,automation_key)
   SELECT ?,a.id,'custom','["接触跟进"]','P2','system',?,?,?,?,'rule','open',?,?,?,?,?,? FROM archives a
   WHERE a.id=? AND a.version=? AND a.updated_at=? AND a.closed=0 AND a.deleted=0 AND EXISTS(SELECT 1 FROM members s WHERE s.id=? AND s.identity_kind='service' AND s.frozen=0)
    AND NOT EXISTS(SELECT 1 FROM work_tasks t WHERE t.archive_id=a.id AND t.automation_rule=? AND t.status='open')`,
   taskId,zaojiSubject.id,title,purpose,delivery,deadline,zaojiSubject.id,at,at,archiveFollowUpRule,t.updated_at,t.id,t.version,t.updated_at,zaojiSubject.id,archiveFollowUpRule),
  c.stmt(`INSERT INTO work_task_events(id,task_id,actor_id,source,kind,after_json,created_at)
   SELECT ?,id,?,'system','task.created',?,? FROM work_tasks WHERE id=?`,c.eventId,zaojiSubject.id,JSON.stringify({automation_rule:archiveFollowUpRule,trigger_updated_at:t.updated_at,deadline_at:deadline,initiator_kind:'system'}),at,taskId),
 ];
}
export const archiveFollowUpModule:RuleModule<Context,D1PreparedStatement>={
 id:'archive-follow-up',source:'app/rules/archive-follow-up.ts',
 triggers:[{file:'app/server/archive-follow-ups.ts',entry:'generateArchiveFollowUps'},{file:'app/server/archive-follow-ups.ts',entry:'generateScheduledArchiveFollowUps'}],
 rules:[{id:archiveFollowUpRule,when:needsArchiveFollowUp,apply:createArchiveFollowUp}],
 verification:{transaction:{file:'app/server/archive-follow-ups.ts',entry:'generateScheduledArchiveFollowUps'},guard:{file:'app/rules/archive-follow-up.ts',entry:'createArchiveFollowUp'},tests:['tests/archive-follow-ups.test.mjs'],idempotency:'档案 ID + automation_rule + 档案更新时间唯一；另以事务内 NOT EXISTS 阻止同类开启任务叠加。',failure:'任务与创建事件一起提交；版本变化时跳过，后续扫描重新判断；规则不修改档案。'},
};
export function planArchiveFollowUp(context:Context){return planRules(archiveFollowUpModule,context);}
