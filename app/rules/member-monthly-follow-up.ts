import {zaojiSubject} from './service-subjects.ts';
import {memberArchiveSql} from './person-identity.ts';
import {isMemberArchive} from './archive-states.ts';
import {planRules,type RuleModule} from './contract.ts';

export const memberMonthlyCopy={purpose:'了解社员近期在做什么、有什么想法，以及需要哪些资源或帮助，保持联系，为后续参与和协作提供依据。',delivery:'将本次了解到的重要变化写入社员档案的观察记录：近期在做的事情与进展、本人想法与参与意愿、需要的支持，以及约定的后续事项。有变化时更新相关档案信息，再提交任务交付。按实际沟通记录，不要求逐项问完；暂未联系到也如实说明。'};
export const memberMonthlyRule='member.monthly_follow_up';
export const legacyMemberMonthlyCopy={purpose:'了解社员本月的近况、参与意愿、需要的支持和联系情况，保持持续的人事联系。',delivery:'将实际接触情况与结论写入社员档案的观察记录，再提交任务交付；暂时联系不到也如实记录。必要时维护可接工作、请假或失联状态，不为完成任务编造沟通。'};
export function canRefreshMemberMonthlyCopy(t:{status:string;kind:string;source:string;automation_rule?:string|null;period_key?:string|null;purpose:string;delivery:string},period:string){return t.status==='open'&&t.kind==='monthly'&&t.source==='rule'&&t.automation_rule===memberMonthlyRule&&t.period_key===period&&t.purpose===legacyMemberMonthlyCopy.purpose&&t.delivery===legacyMemberMonthlyCopy.delivery;}

export type MonthlyTarget={id:string;name:string;type:'person'|'org';status:string;person_role:'member'|'external'|null;closed:boolean;deleted:boolean;version:number};
// A business month is always Asia/Shanghai, regardless of scheduler host timezone.
export function memberMonth(at:string){
 const local=new Date(Date.parse(at)+8*3600000),year=local.getUTCFullYear(),month=local.getUTCMonth();
 return {key:`${year}-${String(month+1).padStart(2,'0')}`,title:`${month+1}月人事跟进`,deadline:new Date(Date.UTC(year,month+1,1)-8*3600000-1).toISOString()};
}
type Context={target:MonthlyTarget;at:string;taskId:string;eventId:string;stmt:(sql:string,...args:unknown[])=>D1PreparedStatement};
export function needsMemberMonthly(c:Context){return isMemberArchive(c.target)&&!c.target.closed&&!c.target.deleted;}
export function createMemberMonthly(c:Context){
 const month=memberMonth(c.at),t=c.target;
 const {purpose,delivery}=memberMonthlyCopy;
 return [c.stmt(`INSERT INTO work_tasks(id,archive_id,kind,labels_json,priority,initiator_kind,initiator_id,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at,period_key,automation_rule,automation_key)
  SELECT ?,a.id,'monthly','["月度沟通"]','P2','system',?,?,?,?,'rule','open',?,?,?,?,?,?,? FROM archives a
  WHERE a.id=? AND a.version=? AND ${memberArchiveSql()} AND a.closed=0 AND a.deleted=0
   AND EXISTS(SELECT 1 FROM members WHERE id=? AND identity_kind='service' AND frozen=0)
  ON CONFLICT(archive_id,kind,period_key) WHERE kind='monthly' AND period_key IS NOT NULL DO NOTHING`,
 c.taskId,zaojiSubject.id,month.title,purpose,delivery,month.deadline,zaojiSubject.id,c.at,c.at,month.key,memberMonthlyRule,month.key,t.id,t.version,zaojiSubject.id),
 c.stmt(`INSERT INTO work_task_events(id,task_id,actor_id,source,kind,after_json,created_at)
  SELECT ?,id,?,'system','task.created',?,? FROM work_tasks WHERE id=?`,c.eventId,zaojiSubject.id,JSON.stringify({automation_rule:memberMonthlyRule,period_key:month.key,deadline_at:month.deadline,initiator_kind:'system'}),c.at,c.taskId)];
}
export const memberMonthlyModule:RuleModule<Context,D1PreparedStatement>={
 id:'member-monthly-follow-up',source:'app/rules/member-monthly-follow-up.ts',
 triggers:[{file:'app/server/member-monthly-follow-ups.ts',entry:'generateMemberMonthlyFollowUps'},{file:'app/server/member-monthly-follow-ups.ts',entry:'generateScheduledMemberMonthlyFollowUps'}],
 rules:[{id:memberMonthlyRule,when:needsMemberMonthly,apply:createMemberMonthly}],
 verification:{transaction:{file:'app/server/member-monthly-follow-ups.ts',entry:'generateScheduledMemberMonthlyFollowUps'},guard:{file:'app/rules/member-monthly-follow-up.ts',entry:'createMemberMonthly'},tests:['tests/member-monthly-follow-ups.test.mjs'],idempotency:'档案 ID + monthly + 北京时间年月唯一，完成/取消仍占用本月义务；每小时补漏，不阻止下月生成。',failure:'任务和创建事件一起提交；提交时复核社员身份、版本、开启状态与服务冻结；失败下次重试。'},
};
export function planMemberMonthly(context:Context){return planRules(memberMonthlyModule,context);}
