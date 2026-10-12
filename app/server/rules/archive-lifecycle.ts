import {isClosedState,isWorkState,statesFor,isMemberArchive,type MemberBasicState} from '../../shared/archive-states.ts';
import {Failure,uid} from '../types.ts';
import type {Archive,BoundMember} from '../archives.ts';
import type {TagState} from '../tag-state.ts';
import type {Source} from '../commands.ts';
import {planRules,type RuleModule} from './contract.ts';

export type Transition={old:Archive;status:string;memberIds:string[];reopen:boolean;memberStatus?:MemberBasicState|null;membershipAction?:'leave'|'to_friend'};
type Effects=Transition&{
 stageTask?:PersonnelTask|null;at:string;actorId:string;source:Source;members:BoundMember[];bindings:D1PreparedStatement[];tags:TagState;
 stmt:(sql:string,...args:unknown[])=>D1PreparedStatement;
 event:(id:string,kind:string,before:unknown,after:unknown,at:string)=>D1PreparedStatement;
};

export function assertReopenAllowed(c:Transition){
 if(isMemberArchive(c.old)&&c.status!==c.old.status&&!((c.membershipAction==='leave'&&c.status==='已弃用')||(c.membershipAction==='to_friend'&&c.status==='外部社友')))throw new Failure(409,'MEMBERSHIP_ACTION_REQUIRED','社员请通过退出组织或转为社友改变身份，不能单独关闭或改为外部人事状态');
 if(c.membershipAction&&(!isMemberArchive(c.old)||!((c.membershipAction==='leave'&&c.status==='已弃用')||(c.membershipAction==='to_friend'&&c.status==='外部社友'))))throw new Failure(400,'INVALID_MEMBERSHIP_ACTION','身份变更与目标状态不一致');
 if(c.memberStatus&&c.status!=='已入伙')throw new Failure(400,'MEMBER_STATUS_NOT_APPLICABLE','基本状态只适用于社员档案');
 if(c.reopen&&(!c.old.closed||isClosedState(c.status)))throw new Failure(409,'INVALID_REOPEN','只能显式重新开启已关闭档案，并选择开启类状态');
}
export function assertStateAndResponsibility(type:'person'|'org',status:string,ids:string[]){
 if(!(statesFor(type) as readonly string[]).includes(status))throw new Failure(400,'INVALID_STATE','该状态不属于这类档案');
 if(isWorkState(type,status)&&ids.length===0)throw new Failure(400,'RESPONSIBLE_REQUIRED','工作状态必须明确选择至少一名负责成员');
}
export function transitionChanged(c:Transition){
 return c.reopen||memberStatusChanged(c)||c.status!==c.old.status||JSON.stringify(c.old.members.map(m=>m.id).sort())!==JSON.stringify(c.memberIds);
}
export function stateChanged(c:Transition){return c.status!==c.old.status;}
export function onlyMembersChanged(c:Transition){return transitionChanged(c)&&!stateChanged(c)&&!memberStatusChanged(c);}
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
 const leavesMembership=isMemberArchive(c.old)&&c.status!=='已入伙';
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
 return stateChanged(c)&&((isMemberArchive(c.old)&&c.status!=='已入伙')||isClosedState(c.status));
}

function notifyManualTasksWhen(c:Transition){
 return stateChanged(c)&&c.old.type==='person';
}

function saveStateAndBindings(c:Effects){
 const closed=isClosedState(c.status);
 return [c.stmt('UPDATE archives SET status=?,person_role=?,member_status=?,closed=?,last_open_status=?,version=version+1,updated_at=? WHERE id=?',c.status,c.old.type==='person'?(c.status==='已入伙'?'member':'external'):null,c.status==='已入伙'?(c.memberStatus??(isMemberArchive(c.old)?c.old.member_status:null)??'可接工作'):null,closed?1:0,closed?(isMemberArchive(c.old)?null:c.old.status):c.old.last_open_status,c.at,c.old.id),
  c.stmt('DELETE FROM archive_bindings WHERE archive_id=? AND status=?',c.old.id,c.status),...c.bindings];
}
function recordStateChange(c:Effects){
 return [c.event(c.old.id,'archive.state_changed',{status:c.old.status,members:c.old.members},{status:c.status,members:c.members,...(c.stageTask?{task_id:c.stageTask.id}:{}),...(c.status==='已入伙'?{person_role:'member',member_status:c.memberStatus??'可接工作'}:{})},c.at)];
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


export type PersonnelTask={id:string;kind:'audit'|'onboarding';deadline:string;created:boolean};
export async function preparePersonnelTask(stmt:Effects['stmt'],archiveId:string,status:string,deadline:string){
 const kind=status==='人事审核'?'audit':status==='已加入待对接'?'onboarding':null;
 if(!kind)return null;
 const existing=await stmt("SELECT id FROM work_tasks WHERE archive_id=? AND kind=? AND source='rule' AND status='open' ORDER BY created_at DESC LIMIT 1",archiveId,kind).first<{id:string}>();
 return {id:existing?.id??uid(),kind,deadline,created:!existing} as PersonnelTask;
}
export function personnelTaskStatements(c:Pick<Effects,'stageTask'|'old'|'at'|'actorId'|'source'|'stmt'>){
 const task=c.stageTask;if(!task?.created)return [];
 const title=task.kind==='audit'?'人事审核':'入社对接';
 const purpose=task.kind==='audit'?'了解对方情况、意愿以及可能参与的方向，形成有依据的审核结论。':'向新社员介绍组织与参与方式，落实后续联系和参与安排。';
 const delivery=task.kind==='audit'?'将审核观察与结论写入关联档案，按实际决定调整人事状态。':'将对接结果与后续安排写入关联档案，对接完成后将人事状态切为已入伙。';
 const result={id:task.id,archive_id:c.old.id,kind:task.kind,title:`${c.old.name} · ${title}`,purpose,delivery,status:'open',owner_id:null,initiator_kind:'member',initiator_id:c.actorId,deadline_at:task.deadline};
 return [c.stmt("INSERT INTO work_tasks(id,archive_id,kind,labels_json,priority,initiator_kind,initiator_id,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at) VALUES(?,?,?,?,'P1','member',?,?,?,?,'rule','open',?,?,?,?)",task.id,c.old.id,task.kind,JSON.stringify([task.kind]),c.actorId,result.title,purpose,delivery,task.deadline,c.actorId,c.at,c.at),
 c.stmt("INSERT INTO work_task_events(id,task_id,actor_id,source,kind,after_json,created_at) VALUES(?,?,?,?,'task.created',?,?)",uid(),task.id,c.actorId,c.source,JSON.stringify(result),c.at)];
}
function createsPersonnelTask(c:Effects){return !!c.stageTask?.created;}
export function memberStatusChanged(c:Transition){return c.status==='已入伙'&&isMemberArchive(c.old)&&!!c.memberStatus&&c.memberStatus!==c.old.member_status;}
function recordMemberStatus(c:Effects){return [c.event(c.old.id,'archive.member_status_changed',{member_status:c.old.member_status,members:c.old.members},{member_status:c.memberStatus,members:c.members},c.at)];}

// Ordered definitions are executed by Archives, and consumed by the rule-view generator.
// These produce SQL for command()'s EXISTING atomic batch; no rule commits independently.
export const archiveTransitionRules=[
 {id:'save-state',when:transitionChanged,apply:saveStateAndBindings},
 {id:'personnel-task',when:createsPersonnelTask,apply:personnelTaskStatements},
 {id:'member-status-history',when:memberStatusChanged,apply:recordMemberStatus},
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
  tests:['tests/archive-lifecycle.test.mjs','tests/member-archives.test.mjs','tests/monthly-work-tasks.test.mjs','tests/work-tasks.test.mjs','tests/business-rule-view.test.mjs','tests/rule-contract.test.ts'],
  idempotency:'command 请求收据；transitionChanged 排除无变化操作；档案版本事务校验；任务取消仅匹配 open，消息沿用现有唯一约束。',
  failure:'预校验失败不提交；事务内权限或版本冲突、SQL 失败整体回滚。保留现有行为，不新增任务轮次语义。',
 },
};

export function planArchiveEffects(context:Effects){
 return planRules(archiveLifecycleModule,context).statements;
}
