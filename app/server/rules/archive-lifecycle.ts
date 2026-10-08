import {isClosedState,isWorkState,statesFor,memberStatuses} from '../../shared/archive-states.ts';
import {Failure} from '../types.ts';
import type {Archive,BoundMember} from '../archives.ts';
import type {TagState} from '../tag-state.ts';
import type {Source} from '../commands.ts';
import {planRules,type RuleModule} from './contract.ts';

export type Transition={old:Archive;status:string;memberIds:string[];reopen:boolean};
type Effects=Transition&{
 at:string;actorId:string;source:Source;members:BoundMember[];bindings:D1PreparedStatement[];tags:TagState;
 stmt:(sql:string,...args:unknown[])=>D1PreparedStatement;
 event:(id:string,kind:string,before:unknown,after:unknown,at:string)=>D1PreparedStatement;
};

export function assertReopenAllowed(c:Transition){
 if(c.reopen&&(!c.old.closed||isClosedState(c.status)))throw new Failure(409,'INVALID_REOPEN','只能显式重新开启已关闭档案，并选择开启类状态');
}
export function assertStateAndResponsibility(type:'person'|'org',status:string,ids:string[]){
 if(!(statesFor(type) as readonly string[]).includes(status))throw new Failure(400,'INVALID_STATE','该状态不属于这类档案');
 if(isWorkState(type,status)&&ids.length===0)throw new Failure(400,'RESPONSIBLE_REQUIRED','工作状态必须明确选择至少一名负责成员');
}
export function transitionChanged(c:Transition){
 return c.reopen||c.status!==c.old.status||JSON.stringify(c.old.members.map(m=>m.id).sort())!==JSON.stringify(c.memberIds);
}
export function stateChanged(c:Transition){return c.status!==c.old.status;}
export function onlyMembersChanged(c:Transition){return transitionChanged(c)&&!stateChanged(c);}
export function closesArchive(c:Transition){return transitionChanged(c)&&isClosedState(c.status);}
export function reopensArchive(c:Transition){return c.reopen;}
export function withdrawsAudit(c:Transition){
 return c.old.type==='person'&&stateChanged(c)&&['引荐中（待人事组接触）','人事审核'].includes(c.old.status)&&['视奸观察','个人接触','外部社友','已弃用'].includes(c.status);
}
export function auditCancellationTarget(task:{id:string;kind:string;source:string},old:Pick<Archive,'type'|'status'|'closed'|'deleted'>,change:{before:{status?:unknown}|null;after:{task_id?:unknown}|null}|null){
 if(task.kind!=='audit'||task.source!=='rule'||old.type!=='person'||old.closed||old.deleted||old.status!=='人事审核'||change?.after?.task_id!==task.id)return null;
 const previous=change.before?.status;
 return typeof previous==='string'&&['视奸观察','个人接触','外部社友'].includes(previous)?previous:null;
}

function cancelWithdrawnAudit(c:Effects){
 const reason=`档案从${c.old.status}转为${c.status}，撤回人事审核`;
 return [
  c.stmt(`INSERT INTO work_task_events(id,task_id,actor_id,source,kind,before_json,after_json,reason,created_at)
   SELECT lower(hex(randomblob(16))),id,?,?,'task.cancelled',
    json_object('status',status,'owner_id',owner_id,'version',version),
    json_object('status','cancelled','owner_id',owner_id,'version',version+1),?,?
   FROM work_tasks WHERE archive_id=? AND kind='audit' AND source='rule' AND status='open'`,c.actorId,c.source,reason,c.at,c.old.id),
  c.stmt("UPDATE work_tasks SET status='cancelled',closed_reason=?,updated_at=?,version=version+1 WHERE archive_id=? AND kind='audit' AND source='rule' AND status='open'",reason,c.at,c.old.id),
 ];
}

function cancelsInapplicableTasks(c:Effects){
 const leavesMembership=c.old.type==='person'&&memberStatuses.includes(c.old.status as typeof memberStatuses[number])&&!memberStatuses.includes(c.status as typeof memberStatuses[number]);
 const kinds=isClosedState(c.status)?"'audit','monthly','onboarding'":leavesMembership?"'monthly','onboarding'":null;
 if(!kinds)return [];
 const reason=`档案从${c.old.status}变为${c.status}，关联工作不再适用`;
 return [
  c.stmt(`INSERT INTO work_task_events(id,task_id,actor_id,source,kind,before_json,after_json,reason,created_at)
   SELECT lower(hex(randomblob(16))),id,?,?,'task.cancelled',
    json_object('status',status,'owner_id',owner_id,'version',version),
    json_object('status','cancelled','owner_id',owner_id,'version',version+1),?,?
   FROM work_tasks WHERE archive_id=? AND source='rule' AND kind IN (${kinds}) AND status='open'`,c.actorId,c.source,reason,c.at,c.old.id),
  c.stmt(`UPDATE work_tasks SET status='cancelled',closed_reason=?,updated_at=?,version=version+1 WHERE archive_id=? AND source='rule' AND kind IN (${kinds}) AND status='open'`,reason,c.at,c.old.id),
 ];
}

function notifyManualTasks(c:Effects){
 if(!stateChanged(c)||c.old.type!=='person')return [];
 const reason=`档案状态已从${c.old.status}变为${c.status}，请负责人核对合作任务是否继续`;
 return [
  c.stmt(`INSERT INTO work_task_events(id,task_id,actor_id,source,kind,before_json,after_json,reason,created_at)
   SELECT lower(hex(randomblob(16))),id,?,?,'task.archive_status_changed',
    json_object('archive_status',?),json_object('archive_status',?,'owner_id',owner_id),?,?
   FROM work_tasks WHERE archive_id=? AND status='open' AND kind='cooperation'`,c.actorId,c.source,c.old.status,c.status,reason,c.at,c.old.id),
  c.stmt(`INSERT INTO messages(id,recipient_id,kind,task_id,object_type,object_id,title,body,task_version,deadline_at,created_at)
   SELECT lower(hex(randomblob(16))),owner_id,'archive_status_changed',id,'work_task',id,'关联档案状态已变化',?,version,deadline_at,?
   FROM work_tasks t WHERE archive_id=? AND status='open' AND kind='cooperation' AND owner_id IS NOT NULL
   ON CONFLICT(recipient_id,kind,object_type,object_id,deadline_at) DO UPDATE SET body=excluded.body,task_version=excluded.task_version,created_at=excluded.created_at,read_at=NULL`,reason,c.at,c.old.id),
 ];
}

function cancelInapplicableTasksWhen(c:Transition){
 return stateChanged(c)&&((c.old.type==='person'&&memberStatuses.includes(c.old.status as typeof memberStatuses[number])&&!memberStatuses.includes(c.status as typeof memberStatuses[number]))||isClosedState(c.status));
}

function notifyManualTasksWhen(c:Transition){
 return stateChanged(c)&&c.old.type==='person';
}

function saveStateAndBindings(c:Effects){
 const closed=isClosedState(c.status);
 return [c.stmt('UPDATE archives SET status=?,closed=?,last_open_status=?,version=version+1,updated_at=? WHERE id=?',c.status,closed?1:0,closed?c.old.status:c.old.last_open_status,c.at,c.old.id),
  c.stmt('DELETE FROM archive_bindings WHERE archive_id=? AND status=?',c.old.id,c.status),...c.bindings];
}
function recordStateChange(c:Effects){
 return [c.event(c.old.id,'archive.state_changed',{status:c.old.status,members:c.old.members},{status:c.status,members:c.members},c.at)];
}
function recordMembersChange(c:Effects){
 return [c.event(c.old.id,'archive.members_changed',{status:c.old.status,members:c.old.members},{status:c.status,members:c.members},c.at)];
}
function freezeTagsAndRecordClosure(c:Effects){
 return [c.tags.snapshot(c.old.id,c.old.version+1),c.stmt('UPDATE archives SET tag_snapshot_version=? WHERE id=?',c.old.version+1,c.old.id),
  c.event(c.old.id,'archive.closed',{status:c.old.status},{status:c.status,tag_snapshot_version:c.old.version+1},c.at)];
}
function recordReopening(c:Effects){
 return [c.event(c.old.id,'archive.reopened',{status:c.old.status},{status:c.status},c.at)];
}

// Ordered definitions are executed by Archives, and consumed by the rule-view generator.
// These produce SQL for command()'s EXISTING atomic batch; no rule commits independently.
export const archiveTransitionRules=[
 {id:'save-state',when:transitionChanged,apply:saveStateAndBindings},
 {id:'state-history',when:stateChanged,apply:recordStateChange},
 {id:'members-history',when:onlyMembersChanged,apply:recordMembersChange},
 {id:'withdraw-audit',when:withdrawsAudit,apply:cancelWithdrawnAudit},
 {id:'cancel-inapplicable-tasks',when:cancelInapplicableTasksWhen,apply:cancelsInapplicableTasks},
 {id:'notify-manual-tasks',when:notifyManualTasksWhen,apply:notifyManualTasks},
 {id:'close',when:closesArchive,apply:freezeTagsAndRecordClosure},
 {id:'reopen',when:reopensArchive,apply:recordReopening},
] as const;

export const archiveLifecycleModule:RuleModule<Effects,D1PreparedStatement>={
 id:'archive-lifecycle',source:'app/server/rules/archive-lifecycle.ts',
 triggers:[{file:'app/server/archives.ts',entry:'transition'},{file:'app/server/work-tasks.ts',entry:'restoreCancelledAudit'}],
 rules:archiveTransitionRules,
 verification:{
  transaction:{file:'app/server/commands.ts',entry:'command'},
  guard:{file:'app/server/archives.ts',entry:'guard'},
  tests:['tests/archive-lifecycle.test.mjs','tests/monthly-work-tasks.test.mjs','tests/work-tasks.test.mjs','tests/business-rule-view.test.mjs','tests/rule-contract.test.ts'],
  idempotency:'command 请求收据；transitionChanged 排除无变化操作；档案版本事务校验；任务取消仅匹配 open，消息沿用现有唯一约束。',
  failure:'预校验失败不提交；事务内权限或版本冲突、SQL 失败整体回滚。保留现有行为，不新增任务轮次语义。',
 },
};

export function planArchiveEffects(context:Effects){
 return planRules(archiveLifecycleModule,context).statements;
}
