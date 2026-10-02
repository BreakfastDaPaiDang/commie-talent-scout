import {isClosedState,isWorkState,statesFor} from '../../shared/archive-states.ts';
import {Failure} from '../types.ts';
import type {Archive,BoundMember} from '../archives.ts';
import type {TagState} from '../tag-state.ts';
import type {Source} from '../commands.ts';

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
 {id:'close',when:closesArchive,apply:freezeTagsAndRecordClosure},
 {id:'reopen',when:reopensArchive,apply:recordReopening},
] as const;

export function planArchiveEffects(context:Effects){
 return archiveTransitionRules.flatMap(rule=>rule.when(context)?rule.apply(context):[]);
}
