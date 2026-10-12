import {z} from 'zod';
import {now,uid,type Actor,type Env} from './types.ts';
import {eventVisibility,unreadPredicate} from './reading-predicates.ts';
export {eventVisibility,unreadPredicate} from './reading-predicates.ts';
import {NotificationQuery} from './notification-query.ts';

export type ReadDelivery={event_id:string;ticket:string};
export const confirmReadingInput=z.object({tickets:z.array(z.uuid()).min(1).max(100)}).strict();
export const unreadListInput=z.object({archive_id:z.uuid().optional(),exclude_archive_id:z.uuid().optional(),exclude_event_id:z.uuid().optional(),before:z.coerce.number().int().positive().optional(),snapshot:z.coerce.number().int().nonnegative().optional(),limit:z.coerce.number().int().min(1).max(100).default(30)});
// A GET only creates a delivery receipt. The recipient confirms it after receiving/rendering
// that exact content. MCP event receipts and webpage opening snapshots both create
// independent event marks; neither maintains an advancing archive read watermark.
export class Reading{
 constructor(readonly env:Env,readonly actor:Actor){}
 stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async deliver(events:{id:string;observation?:{version:number}|null}[]):Promise<Map<string,ReadDelivery>>{
  const result=new Map<string,ReadDelivery>();if(!events.length)return result;
  const unread=unreadPredicate(this.actor);
  const rows=await this.stmt(`SELECT e.id,o.version FROM archive_events e LEFT JOIN observations o ON o.id=e.observation_id WHERE e.id IN (SELECT value FROM json_each(?)) AND ${unread.sql}`,JSON.stringify(events.map(e=>e.id)),...unread.args).all<{id:string;version:number|null}>();
  const rowsToInsert:{id:string;event_id:string;version:number|null}[]=[];
  for(const row of rows.results){const rendered=events.find(e=>e.id===row.id)!;if(rendered.observation&&rendered.observation.version!==row.version)continue;const ticket=uid();result.set(row.id,{event_id:row.id,ticket});rowsToInsert.push({id:ticket,event_id:row.id,version:row.version});}
  if(rowsToInsert.length)await this.stmt("INSERT INTO reading_deliveries SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.event_id'),json_extract(value,'$.version'),? FROM json_each(?)",this.actor.credential_id,this.actor.id,new Date(Date.now()+86400000).toISOString(),JSON.stringify(rowsToInsert)).run();return result;
 }
 async observationDeliveries(items:{id:string;version:number;deleted:boolean}[]){
  const active=items.filter(o=>!o.deleted);if(!active.length)return new Map<string,ReadDelivery>();
  const rows=await this.stmt(`SELECT id,observation_id FROM archive_events e WHERE observation_id IN (SELECT value FROM json_each(?)) AND seq=(SELECT max(seq) FROM archive_events t WHERE t.observation_id=e.observation_id)`,JSON.stringify(active.map(o=>o.id))).all<{id:string;observation_id:string}>();
  const deliveries=await this.deliver(rows.results.map(e=>({id:e.id,observation:active.find(o=>o.id===e.observation_id)!})));return new Map(rows.results.flatMap(e=>deliveries.has(e.id)?[[e.observation_id,deliveries.get(e.id)!]]:[]));
 }
 async confirm(input:unknown){
  const a=confirmReadingInput.parse(input),tickets=[...new Set(a.tickets)],visible=eventVisibility(this.actor),at=now();
  // INSERT SELECT makes version/visibility checks and the idempotent mark one atomic write.
  await this.stmt(`INSERT OR IGNORE INTO event_read_marks(member_id,event_id,read_at) SELECT ?,e.id,? FROM reading_deliveries d JOIN archive_events e ON e.id=d.event_id LEFT JOIN observations o ON o.id=e.observation_id WHERE d.id IN (SELECT value FROM json_each(?)) AND d.credential_id=? AND d.member_id=? AND d.expires_at>? AND d.observation_version IS o.version AND EXISTS(SELECT 1 FROM archives readable WHERE readable.id=e.archive_id AND readable.deleted=0) AND ${visible.sql}`,this.actor.id,at,JSON.stringify(tickets),this.actor.credential_id,this.actor.id,at,...visible.args).run();
  const rows=await this.stmt(`SELECT d.id ticket,d.event_id,EXISTS(SELECT 1 FROM event_read_marks m WHERE m.member_id=d.member_id AND m.event_id=d.event_id) confirmed FROM reading_deliveries d WHERE d.id IN (SELECT value FROM json_each(?)) AND d.credential_id=? AND d.member_id=?`,JSON.stringify(tickets),this.actor.credential_id,this.actor.id).all<{ticket:string;event_id:string;confirmed:number}>();
  return {confirmed:rows.results.filter(r=>r.confirmed).map(({ticket,event_id})=>({ticket,event_id})),unconfirmed:tickets.filter(t=>!rows.results.some(r=>r.ticket===t&&r.confirmed))};
 }
 async summary(){return new NotificationQuery(this.env,this.actor).archiveSummary();}
 async list(input:unknown){return new NotificationQuery(this.env,this.actor).archiveEvents(unreadListInput.parse(input));}
}
