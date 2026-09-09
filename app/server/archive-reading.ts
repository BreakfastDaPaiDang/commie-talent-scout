import {z} from 'zod';
import {unreadPredicate} from './reading.ts';
import {authGuard} from './credentials.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';

export type ArchiveReadDelivery={ticket:string;archive_id:string;through_seq:number};
export type ArchiveReadConfirmation={member_id:string;archive_id:string;through_seq:number;confirmed:true;unread_event_ids:string[]};
const input=z.object({ticket:z.uuid()}).strict();

// Opening the webpage confirms an archive snapshot; reading individual MCP content
// keeps using event receipts. Both write the same personal event_read_marks.
export class ArchiveReading{
 constructor(readonly env:Env,readonly actor:Actor){}
 stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async deliver(id:string):Promise<ArchiveReadDelivery|null>{
  z.uuid().parse(id);const ticket=uid(),key=uid(),unread=unreadPredicate(this.actor);
  // Freeze both the event boundary and the currently visible unread set. An old
  // hidden evidence event must not become acknowledged if its source is restored later.
  try{await this.env.DB.batch([
   authGuard(this.env,this.actor,key,this.actor.role==='admin'),
   this.stmt('INSERT INTO archive_reading_deliveries(id,credential_id,member_id,archive_id,through_seq,expires_at) SELECT ?,?,?,a.id,coalesce((SELECT max(seq) FROM archive_events WHERE archive_id=a.id),0),? FROM archives a WHERE a.id=? AND a.deleted=0',ticket,this.actor.credential_id,this.actor.id,new Date(Date.now()+86400000).toISOString(),id),
   this.stmt(`INSERT INTO archive_reading_delivery_events SELECT d.id,e.id FROM archive_reading_deliveries d JOIN archive_events e ON e.archive_id=d.archive_id AND e.seq<=d.through_seq WHERE d.id=? AND ${unread.sql}`,ticket,...unread.args),
   this.stmt('DELETE FROM mutation_guards WHERE id=?',key),
  ]);}catch(error){if(String(error).includes('CHECK constraint'))throw new Failure(409,'READING_EXPIRED','账号或连接已变更，请重新打开档案');throw error;}
  const head=await this.stmt('SELECT through_seq FROM archive_reading_deliveries WHERE id=?',ticket).first<{through_seq:number}>();
  return head?{ticket,archive_id:id,through_seq:head.through_seq}:null;
 }
 async confirm(value:unknown):Promise<ArchiveReadConfirmation>{
  const {ticket}=input.parse(value),at=now(),receipt=await this.stmt('SELECT d.archive_id,d.through_seq FROM archive_reading_deliveries d JOIN archives a ON a.id=d.archive_id WHERE d.id=? AND d.credential_id=? AND d.member_id=? AND d.expires_at>? AND a.deleted=0',ticket,this.actor.credential_id,this.actor.id,at).first<{archive_id:string;through_seq:number}>();
  if(!receipt)throw new Failure(409,'READING_EXPIRED','已读确认已失效，请重新打开档案');
  const unread=unreadPredicate(this.actor);
  const key=uid();
  try{await this.env.DB.batch([
   authGuard(this.env,this.actor,key,this.actor.role==='admin'),
   this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archive_reading_deliveries d JOIN archives a ON a.id=d.archive_id WHERE d.id=? AND d.credential_id=? AND d.member_id=? AND d.expires_at>? AND a.deleted=0) THEN 1 ELSE 0 END)`,key+':delivery',ticket,this.actor.credential_id,this.actor.id,at),
   this.stmt(`INSERT OR IGNORE INTO event_read_marks(member_id,event_id,read_at) SELECT ?,e.id,? FROM archive_reading_deliveries d JOIN archive_reading_delivery_events delivered ON delivered.delivery_id=d.id JOIN archive_events e ON e.id=delivered.event_id WHERE d.id=? AND d.credential_id=? AND d.member_id=? AND d.expires_at>? AND d.confirmed_at IS NULL AND ${unread.sql}`,this.actor.id,at,ticket,this.actor.credential_id,this.actor.id,at,...unread.args),
   this.stmt('UPDATE archive_reading_deliveries SET confirmed_at=coalesce(confirmed_at,?) WHERE id=?',at,ticket),
   this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key,key+':delivery'),
  ]);}catch(error){if(String(error).includes('CHECK constraint'))throw new Failure(409,'READING_EXPIRED','已读确认已失效，请重新打开档案');throw error;}
  const remaining=await this.stmt(`SELECT e.id FROM archive_events e WHERE e.archive_id=? AND e.seq<=? AND ${unread.sql}`,receipt.archive_id,receipt.through_seq,...unread.args).all<{id:string}>();
  return {...receipt,member_id:this.actor.id,confirmed:true,unread_event_ids:remaining.results.map(e=>e.id)};
 }
}
