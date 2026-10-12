import {pushCandidates,pushStage,preferenceMatchesSql,type CandidateMember,type TaskKind} from './task-preferences.ts';
import {planRules,type RuleModule} from './contract.ts';

export const TASK_REMINDER_WINDOW_MS=24*60*60*1000;
export type NotificationTask={id:string;kind:TaskKind;status:string;owner_id:string|null;created_at:string;deadline_at:string;version:number};
type Context={task:NotificationTask;members:readonly CandidateMember[];at:string;mode:'overdue'|'due';uid:()=>string;stmt:(sql:string,...args:unknown[])=>D1PreparedStatement};
export function taskOverdue(task:Pick<NotificationTask,'status'|'deadline_at'>,at:string){
 return task.status==='open'&&Date.parse(task.deadline_at)<=Date.parse(at);
}
export function taskDeadlineSoon(task:Pick<NotificationTask,'status'|'deadline_at'>,at:string){
 const remaining=Date.parse(task.deadline_at)-Date.parse(at);
 return task.status==='open'&&remaining>0&&remaining<=TASK_REMINDER_WINDOW_MS;
}
function unclaimed(c:Context){return c.mode==='due'&&c.task.status==='open'&&!c.task.owner_id&&c.task.created_at<=c.at;}
function overdue(c:Context){return c.mode==='overdue'&&!!c.task.owner_id&&taskOverdue(c.task,c.at);}
function dueSoon(c:Context){return c.mode==='due'&&!!c.task.owner_id&&taskDeadlineSoon(c.task,c.at);}
function recommend(c:Context){
 const task={id:c.task.id,kind:c.task.kind,open:c.task.status==='open',ownerId:c.task.owner_id,createdAt:c.task.created_at};
 const stage=pushStage(task,c.at);if(stage==='admin')return [];
 return pushCandidates(task,c.members).map(member=>c.stmt(`INSERT OR IGNORE INTO work_task_pushes(id,task_id,member_id,stage,pushed_at)
  SELECT ?,t.id,?,?,? FROM work_tasks t JOIN members m ON m.id=? AND m.frozen=0 AND m.identity_kind='human'
  WHERE t.id=? AND t.status='open' AND t.owner_id IS NULL AND t.version=?
   AND ${preferenceMatchesSql('m.id')}`,
  c.uid(),member.id,stage,c.at,member.id,c.task.id,c.task.version));
}
function message(c:Context,kind:'task_overdue'|'task_deadline_reminder',title:string,body:string){
 return [c.stmt(`INSERT OR IGNORE INTO messages(id,recipient_id,kind,task_id,object_type,object_id,title,body,task_version,deadline_at,created_at)
  SELECT ?,t.owner_id,?,t.id,'work_task',t.id,?,?,t.version,t.deadline_at,?
  FROM work_tasks t JOIN members m ON m.id=t.owner_id AND m.frozen=0 AND m.identity_kind='human'
  WHERE t.id=? AND t.status='open' AND t.version=? AND t.owner_id=? AND t.deadline_at=?`,
  c.uid(),kind,title,body,c.at,c.task.id,c.task.version,c.task.owner_id,c.task.deadline_at)];
}
function remindOverdue(c:Context){return message(c,'task_overdue','任务已逾期','任务仍保持开启，请提交交付、延期或主动交还。');}
function remindDeadline(c:Context){return message(c,'task_deadline_reminder','任务即将到期',`当前任务将在 ${c.task.deadline_at} 到期，请在期限前提交结果或主动延长期限。`);}

export const taskNotificationsModule:RuleModule<Context,D1PreparedStatement>={
 id:'task-notifications',source:'app/rules/task-notifications.ts',
 triggers:[{file:'app/server/task-notifications.ts',entry:'runTaskNotifications'}],
 rules:[{id:'task.recommend',when:unclaimed,apply:recommend},{id:'task.overdue',when:overdue,apply:remindOverdue},{id:'task.deadline',when:dueSoon,apply:remindDeadline}],
 verification:{transaction:{file:'app/server/task-notifications.ts',entry:'runTaskNotifications'},guard:{file:'app/rules/task-notifications.ts',entry:'message'},tests:['tests/messages.test.mjs','tests/task-notifications.test.mjs'],idempotency:'推荐按任务/成员/阶段唯一；提醒按任务/成员/截止时间唯一。',failure:'每条写入复核任务版本、状态、负责人和成员可用性；重试不重复，不关闭逾期任务。'},
};
export function planTaskNotifications(context:Context){return planRules(taskNotificationsModule,context);}
