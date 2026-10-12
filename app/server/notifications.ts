import {z} from 'zod';
import {NotificationQuery} from './notification-query.ts';
import {Reading} from './reading.ts';
import {ArchiveReading} from './archive-reading.ts';
export {notificationListInput} from './notification-query.ts';
const confirmation=z.discriminatedUnion('mode',[
 z.object({mode:z.literal('all'),snapshot:z.string().max(1000)}).strict(),
 z.object({mode:z.literal('message'),ids:z.array(z.string().regex(/^task:(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)).min(1).max(100)}).strict(),
 z.object({mode:z.literal('event'),tickets:z.array(z.uuid()).min(1).max(100)}).strict(),
 z.object({mode:z.literal('archive'),ticket:z.uuid()}).strict(),
]);
export const notificationConfirmInput=z.object({mode:z.enum(['message','event','archive','all']),snapshot:z.string().max(1000).optional(),ids:z.array(z.string()).max(100).optional(),tickets:z.array(z.uuid()).max(100).optional(),ticket:z.uuid().optional()}).strict();
export class Notifications extends NotificationQuery{
 async confirm(value:unknown){
  const a=confirmation.parse(value);
  if(a.mode==='all')return this.markAll(a.snapshot);
  if(a.mode==='message'){const result=await this.markTasks(a.ids.map(id=>id.slice(5)));return {...result,ids:result.ids.map(id=>'task:'+id)};}
  if(a.mode==='event')return new Reading(this.env,this.actor).confirm({tickets:a.tickets});
  return new ArchiveReading(this.env,this.actor).confirm({ticket:a.ticket});
 }
}
