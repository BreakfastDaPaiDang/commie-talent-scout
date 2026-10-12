import {z} from 'zod';
import {authGuard} from './credentials.ts';
import {uid} from './types.ts';
import {Failure,now,type Actor,type Env} from './types.ts';
import {recipientPredicate} from './reading-predicates.ts';

const booleanQuery=z.union([z.boolean(),z.enum(['true','false'])]).transform(v=>v===true||v==='true');
export const notificationListInput=z.object({source:z.enum(['all','task','archive']).default('all'),unread:booleanQuery.default(false),limit:z.coerce.number().int().min(1).max(100).default(30),cursor:z.string().max(2000).optional(),snapshot:z.string().max(1000).optional(),exclude_archive_id:z.uuid().optional()}).strict();
const boundary=z.object({events:z.number().int().nonnegative(),messages:z.number().int().nonnegative()});
const position=z.object({at:z.string(),id:z.string()});
const encode=(v:unknown)=>btoa(JSON.stringify(v));
function decode<T>(value:string,schema:z.ZodType<T>):T{try{return schema.parse(JSON.parse(atob(value)));}catch{throw new Failure(400,'INVALID_CURSOR','消息分页位置无效，请刷新列表');}}
type Row={id:string;source:'task'|'archive';source_id:string;recipient_id:string;kind:string;created_at:string;read_at:string|null;seq:number;source_row:number;archive_id:string|null;archive_type:string|null;data:string};

// One recipient-scoped read model. Source records and read marks remain authoritative;
// no copied inbox rows or second read-state store need reconciliation.
export class NotificationQuery{
 constructor(readonly env:Env,readonly actor:Actor){}
 private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 private projection(){
  const eligible=recipientPredicate(this.actor),at=now();
  const taskActive=`(m.task_id IS NULL OR (
   t.owner_id=m.recipient_id AND t.version=m.task_version AND (
    (m.kind='task_deadline_reminder' AND t.status='open' AND t.deadline_at=m.deadline_at AND t.deadline_at>?) OR
    (m.kind='task_overdue' AND t.status='open' AND t.deadline_at=m.deadline_at AND t.deadline_at<=?) OR
    (m.kind='task_expired_uncompleted' AND t.status='expired') OR
    (m.kind='archive_status_changed' AND t.status='open'))))`;
  return {sql:`WITH notifications AS (
   SELECT 'task:'||m.id id,'task' source,m.id source_id,m.recipient_id,m.kind,m.created_at,m.read_at,0 seq,m.rowid source_row,t.archive_id,NULL archive_type,
    json_object('id',m.id,'kind',m.kind,'task_id',m.task_id,'object_type',m.object_type,'object_id',m.object_id,'title',m.title,'body',m.body,'deadline_at',m.deadline_at,'created_at',m.created_at,'read_at',m.read_at,'task_status',t.status,'archive_id',t.archive_id,'archive_name',a.name) data
   FROM messages m LEFT JOIN work_tasks t ON t.id=m.task_id LEFT JOIN archives a ON a.id=t.archive_id
   WHERE m.recipient_id=? AND ${taskActive} AND (m.task_id IS NULL OR (t.id IS NOT NULL AND (t.archive_id IS NULL OR a.deleted=0 OR ?='admin')))
    AND EXISTS(SELECT 1 FROM members WHERE id=m.recipient_id AND frozen=0)
   UNION ALL
   SELECT 'archive:'||e.id,'archive',e.id,?,e.kind,e.created_at,mark.read_at,e.seq,e.seq,e.archive_id,a.type,
    json_object('id',e.id,'seq',e.seq,'archive_id',e.archive_id,'actor_id',e.actor_id,'kind',e.kind,'observation_id',e.observation_id,'created_at',e.created_at,'actor_name',writer.name,'archive_name',a.name,'type',a.type,'closed',a.closed)
   FROM archive_events e JOIN archives a ON a.id=e.archive_id JOIN members writer ON writer.id=e.actor_id
    LEFT JOIN event_read_marks mark ON mark.event_id=e.id AND mark.member_id=?
   WHERE ${eligible.sql} AND EXISTS(SELECT 1 FROM members WHERE id=? AND frozen=0)
  )`,args:[this.actor.id,at,at,this.actor.role,this.actor.id,this.actor.id,...eligible.args,this.actor.id]};
 }
 private item(row:Row){return {id:row.id,source:row.source,source_id:row.source_id,recipient_id:row.recipient_id,kind:row.kind,created_at:row.created_at,read:!!row.read_at,read_at:row.read_at,confirmation:row.source==='task'?'message':'content_receipt',data:JSON.parse(row.data) as Record<string,unknown>};}
 async list(value:unknown={}){
  const a=notificationListInput.parse(value),p=this.projection();
  const bounds=a.snapshot?decode(a.snapshot,boundary):await this.stmt('SELECT coalesce((SELECT max(seq) FROM archive_events),0) events,coalesce((SELECT max(rowid) FROM messages),0) messages').first<z.infer<typeof boundary>>() as z.infer<typeof boundary>;
  if(a.cursor&&!a.snapshot)throw new Failure(400,'INVALID_CURSOR','消息分页需要同一次列表的快照');
  const cursor=a.cursor?decode(a.cursor,position):null;
  const where=['source_row<=CASE WHEN source=\'archive\' THEN ? ELSE ? END'],args:unknown[]=[bounds.events,bounds.messages];
  if(a.source!=='all'){where.push('source=?');args.push(a.source);}
  if(a.unread)where.push('read_at IS NULL');
  if(a.exclude_archive_id){where.push('(archive_id IS NULL OR archive_id<>?)');args.push(a.exclude_archive_id);}
  if(cursor){where.push('(created_at<? OR (created_at=? AND id<?))');args.push(cursor.at,cursor.at,cursor.id);}
  const rows=(await this.stmt(`${p.sql} SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ?`,...p.args,...args,a.limit+1).all<Row>()).results;
  const page=rows.slice(0,a.limit),last=page.at(-1);
  return {notifications:page.map(r=>this.item(r)),snapshot:encode(bounds),next_cursor:rows.length>a.limit&&last?encode({at:last.created_at,id:last.id}):null};
 }
 async summary(){
  const p=this.projection(),rows=(await this.stmt(`${p.sql} SELECT source,count(*) total FROM notifications WHERE read_at IS NULL GROUP BY source`,...p.args).all<{source:string;total:number}>()).results;
  const reading=Number(rows.find(r=>r.source==='archive')?.total??0),messages=Number(rows.find(r=>r.source==='task')?.total??0);
  return {total:reading+messages,reading,messages};
 }
 async archiveSummary(){
  const p=this.projection(),groups=(await this.stmt(`${p.sql} SELECT archive_type type,count(*) events,count(DISTINCT archive_id) archives FROM notifications WHERE source='archive' AND read_at IS NULL GROUP BY archive_type`,...p.args).all<{type:string;events:number;archives:number}>()).results;
  return {groups,total:groups.reduce((n,r)=>n+r.events,0)};
 }
 // Compatibility adapter: preserve sequence snapshots and archive navigation used by
 // existing Agents. It uses the same projection and visibility as the unified feed.
 async archiveEvents(a:{snapshot?:number;before?:number;archive_id?:string;exclude_archive_id?:string;exclude_event_id?:string;limit:number}){
  const p=this.projection(),snapshot=a.snapshot??Number((await this.stmt('SELECT coalesce(max(seq),0) seq FROM archive_events').first<{seq:number}>())!.seq);
  if(a.before&&a.before>snapshot+1)throw new Failure(400,'INVALID_CURSOR','分页位置超出本次队列');
  const where=["source='archive'",'read_at IS NULL','seq<=?'],args:unknown[]=[snapshot];
  for(const [column,operator,value] of [['seq','<',a.before],['archive_id','=',a.archive_id],['archive_id','<>',a.exclude_archive_id],['source_id','<>',a.exclude_event_id]] as const){if(value!==undefined){where.push(`${column}${operator}?`);args.push(value);}}
  const rows=(await this.stmt(`${p.sql} SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY seq DESC LIMIT ?`,...p.args,...args,a.limit+1).all<Row>()).results;
  return {events:rows.slice(0,a.limit).map(r=>JSON.parse(r.data) as Record<string,unknown>),snapshot,next_cursor:rows.length>a.limit?String(rows[a.limit-1].seq):null};
 }
 async markAll(snapshot:string){
  const bounds=decode(snapshot,boundary),p=this.projection(),at=now(),key=uid();
  const results=await this.env.DB.batch([
   authGuard(this.env,this.actor,key,this.actor.role==='admin'),
   this.stmt(`${p.sql} UPDATE messages SET read_at=? WHERE read_at IS NULL AND id IN (SELECT source_id FROM notifications WHERE source='task' AND source_row<=?)`,...p.args,at,bounds.messages),
   this.stmt(`${p.sql} INSERT OR IGNORE INTO event_read_marks(member_id,event_id,read_at) SELECT ?,source_id,? FROM notifications WHERE source='archive' AND read_at IS NULL AND source_row<=?`,...p.args,this.actor.id,at,bounds.events),
   this.stmt('DELETE FROM mutation_guards WHERE id=?',key),
  ]);
  return {marked:Number(results[1].meta?.changes??0)+Number(results[2].meta?.changes??0),snapshot};
 }
 async markTasks(ids:string[]){
  const p=this.projection(),unique=[...new Set(ids)];
  const result=await this.stmt(`${p.sql} UPDATE messages SET read_at=coalesce(read_at,?) WHERE id IN (SELECT source_id FROM notifications WHERE source='task' AND source_id IN (SELECT value FROM json_each(?)))`,...p.args,now(),JSON.stringify(unique)).run();
  return {ids:unique,marked:Number(result.meta?.changes??0)};
 }
}
