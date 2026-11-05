import type {InternalResource} from './internal-resources.ts';
import {isMemberArchive} from '../rules/archive-states.ts';
import {reminderDays} from '../rules/archive-reminders.ts';
import type {ResourceEntry} from './archive-resources.ts';

type Subject={type:'person'|'org';status:string;person_role:'member'|'external'|null;closed:boolean;member_status?:'可接工作'|'暂不接工作'|'请假'|'失联'|null;resources:ResourceEntry[];stage_since:string;overdue:boolean;unassigned_tasks:number;overdue_tasks:number};
export function reception(a:Subject){
 const internal=a.resources.filter(r=>!r.restricted&&r.internal_resource_id);
 if(internal.some(r=>!r.restricted&&r.usage==='active'))return 'placed';
 if(isMemberArchive(a)&&a.member_status&&a.member_status!=='可接工作')return 'unavailable';
 return internal.some(r=>!r.restricted&&r.usage==='planned')?'planned':'unarranged';
}
export const receptionLabels={placed:'已落实社内承接',planned:'计划待落实',unarranged:'未安排社内承接',unavailable:'暂不安排工作'};
export function personnelAttention(a:Subject,at=Date.now(),inventory:InternalResource[]=[]){
 if(a.closed)return [];
 const reasons:string[]=[],member=isMemberArchive(a),stable=member||a.status==='外部社友';
 if(!stable&&at-Date.parse(a.stage_since)>reminderDays(a.type,a.status)*86400000)reasons.push('阶段停留待核对');
 if(member&&a.member_status==='失联')reasons.push('社员失联待联系');
 if(member&&(a.member_status??'可接工作')==='可接工作'&&reception(a)!=='placed')reasons.push(reception(a)==='planned'?'承接计划待落实':'社内承接待安排');
 if(a.unassigned_tasks)reasons.push(`待承接任务 ${a.unassigned_tasks} 项`);
 if(a.overdue_tasks)reasons.push(`超期任务 ${a.overdue_tasks} 项`);
 if(a.overdue)reasons.push('资料需更新');
 for(const id of new Set(a.resources.flatMap(r=>!r.restricted&&r.internal_resource_id&&r.usage==='planned'&&!a.resources.some(v=>!v.restricted&&v.internal_resource_id===r.internal_resource_id&&v.usage==='active')?[r.internal_resource_id]:[]))){const resource=inventory.find(r=>r.id===id);if(!resource)continue;if(resource.status!=='accepting')reasons.push(`${resource.name} 暂停承接`);if(resource.overplanned)reasons.push(`${resource.name} 计划超额需协调`);if(!resource.members.some(m=>!m.frozen))reasons.push(`${resource.name} 承接人待明确`);}
 return reasons;
}
