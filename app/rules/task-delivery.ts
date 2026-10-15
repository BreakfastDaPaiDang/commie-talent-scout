import {isMemberArchive,type PersonIdentity} from './archive-states.ts';

// Business provenance, not editable labels, determines whether delivery must leave an archive observation.
export function taskRequiresObservation(task:{archive_id?:unknown;kind?:unknown;automation_rule?:unknown}){
 return !!task.archive_id&&(['audit','onboarding','monthly'].includes(String(task.kind))||task.automation_rule==='archive.follow_up');
}
export const observationRequiredMessage='请先在关联档案中记录观察，再选择至少一条观察提交交付；暂未联系到也可如实记录。';

// Read-time hint only. Neither changing personnel state nor satisfying this condition completes a task.
export function taskDeliveryReady(task:{status?:unknown;kind?:unknown;owner_id?:unknown;source?:unknown},archive:(PersonIdentity&{closed?:boolean;deleted?:boolean})|null){
 if(task.status!=='open'||!task.owner_id||task.source!=='rule'||!archive||archive.closed||archive.deleted)return false;
 if(task.kind==='onboarding')return isMemberArchive(archive);
 if(task.kind==='audit')return archive.status==='已加入待对接'||isMemberArchive(archive);
 return false;
}
