import {isWorkState} from './archive-states.ts';

export const DAY_MS=86_400_000;
export type ArchiveReminder={overdue:boolean;threshold_days:7|30;due_at:string|null};
type Subject={type:'person'|'org';status:string;closed:boolean;deleted?:boolean;updated_at:string};
export function reminderDays(type:Subject['type'],status:string):7|30{return type==='person'&&isWorkState(type,status)?7:30;}
export function archiveReminder(a:Subject,at=Date.now()):ArchiveReminder{
 const threshold_days=reminderDays(a.type,a.status),updated=Date.parse(a.updated_at);
 if(a.closed||a.deleted||!Number.isFinite(updated))return {overdue:false,threshold_days,due_at:null};
 const due=updated+threshold_days*DAY_MS;
 return {overdue:at>due,threshold_days,due_at:new Date(due).toISOString()};
}
