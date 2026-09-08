export const ACTIVITY_WINDOW_MS=5*60*1000;
export type ActivityEvent={id:string;archive_id:string;actor_id:string;created_at:string;kind:string};
export type ActivityGroup<T extends ActivityEvent>={id:string;events:T[];started_at:string;ended_at:string};
// A presentation grouping only: event identities, permissions and reading receipts remain intact.
// Bound the entire group to five minutes, so a chain of edits cannot hide hours of work.
export function groupActivities<T extends ActivityEvent>(events:T[]):ActivityGroup<T>[] {
 const groups:ActivityGroup<T>[]=[];
 for(const event of events){const group=groups.at(-1),first=group?.events[0],at=Date.parse(event.created_at),end=first?Date.parse(first.created_at):NaN;
  if(group&&first&&event.archive_id===first.archive_id&&event.actor_id===first.actor_id&&Number.isFinite(at)&&at<=end&&end-at<=ACTIVITY_WINDOW_MS){group.events.push(event);group.started_at=event.created_at;}
  else groups.push({id:event.id,events:[event],started_at:event.created_at,ended_at:event.created_at});
 }
 return groups;
}
