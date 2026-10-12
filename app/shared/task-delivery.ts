import {isMemberArchive,type PersonIdentity} from './archive-states.ts';

// Read-time hint only. Neither changing personnel state nor satisfying this condition completes a task.
export function taskDeliveryReady(task:{status?:unknown;kind?:unknown;owner_id?:unknown;source?:unknown},archive:(PersonIdentity&{closed?:boolean;deleted?:boolean})|null){
 if(task.status!=='open'||!task.owner_id||task.source!=='rule'||!archive||archive.closed||archive.deleted)return false;
 if(task.kind==='onboarding')return isMemberArchive(archive);
 if(task.kind==='audit')return archive.status==='已加入待对接'||isMemberArchive(archive);
 return false;
}
