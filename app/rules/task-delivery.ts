import {isMemberArchive,type PersonIdentity} from './archive-states.ts';

type DeliveryTask={archive_id?:unknown;source?:unknown;kind?:unknown;requires_observation_reference?:boolean};
export function personnelDeliveryKind(task:DeliveryTask){
 return task.archive_id&&task.source==='rule'&&(task.kind==='audit'||task.kind==='onboarding')?task.kind:null;
}
export const personnelDeliveryResults={
 audit_passed:{kind:'audit',from:'人事审核',to:'已加入待对接',label:'审核通过',effect:'提交后将进入审核通过（待对接），自动创建待领取的入社对接任务，默认期限 7 天。'},
 onboarding_completed:{kind:'onboarding',from:'已加入待对接',to:'已入伙',label:'对接完成',effect:'提交后将转入社员档案，保留原有资料与历史。'},
} as const;
export type PersonnelDeliveryResult=keyof typeof personnelDeliveryResults;
export const isPersonnelDeliveryResult=(result:string):result is PersonnelDeliveryResult=>Object.hasOwn(personnelDeliveryResults,result);
export function taskCompletionOptions(task:DeliveryTask){
 const kind=personnelDeliveryKind(task);
 return [kind?{value:kind==='audit'?'audit_passed':'onboarding_completed',label:kind==='audit'?'审核通过':'对接完成'}:{value:'completed',label:'已完成'},
  {value:'continue',label:'建议继续'},{value:'unable_to_contact',label:'暂未联系到'},{value:'not_suitable',label:'不再继续'}];
}
export function taskCompletionEffect(task:DeliveryTask,result:string){
 if(task.requires_observation_reference&&result==='unable_to_contact')return '记录本次尝试并设置下一次联系时间，任务继续保持开启。';
 if(isPersonnelDeliveryResult(result)&&personnelDeliveryKind(task)===personnelDeliveryResults[result].kind)return personnelDeliveryResults[result].effect;
 return personnelDeliveryKind(task)&&result?'仅结束本次任务，保留档案当前人事阶段。':null;
}
export function taskResultLabel(result:string){
 return isPersonnelDeliveryResult(result)?personnelDeliveryResults[result].label:({completed:'已完成',continue:'建议继续',unable_to_contact:'暂未联系到',not_suitable:'不再继续',joined:'已入伙',discarded:'已弃用'} as Record<string,string>)[result]??result;
}

// Business provenance, not editable labels, determines whether delivery must leave an archive observation.
export function taskRequiresObservation(task:{archive_id?:unknown;kind?:unknown;automation_rule?:unknown;follow_up?:unknown}){
 return !!task.archive_id&&(['audit','onboarding','monthly'].includes(String(task.kind))||task.automation_rule==='archive.follow_up'||!!task.follow_up);
}
export const observationRequiredMessage='请引用本轮任务创建或重新开启后新增的观察。';

// Read-time hint only. Neither changing personnel state nor satisfying this condition completes a task.
export function taskDeliveryReady(task:{status?:unknown;kind?:unknown;owner_id?:unknown;source?:unknown;archive_id?:unknown;automation_rule?:unknown;follow_up?:unknown},archive:(PersonIdentity&{closed?:boolean;deleted?:boolean})|null,hasOwnerRoundObservation=false){
 if(task.status!=='open'||!task.owner_id||!archive||archive.deleted)return false;
 if(taskRequiresObservation(task)&&hasOwnerRoundObservation)return true;
 if(task.source!=='rule'||archive.closed)return false;
 if(task.kind==='onboarding')return isMemberArchive(archive);
 if(task.kind==='audit')return archive.status==='已加入待对接'||isMemberArchive(archive);
 return false;
}
