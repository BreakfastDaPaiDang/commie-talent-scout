import {z} from 'zod';
import {now,type Actor,type Env} from './types.ts';

export const messageListInput=z.object({unread:z.coerce.boolean().default(false),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict();
export const messageReadInput=z.object({ids:z.array(z.uuid()).min(1).max(100)}).strict();
type MessageRow={id:string;recipient_id:string;kind:string;task_id:string|null;object_type:string;object_id:string;title:string;body:string;task_version:number|null;deadline_at:string|null;created_at:string;read_at:string|null;task_status:string|null;task_owner_id:string|null;task_deadline_at:string|null;archive_id:string|null;archive_name:string|null;archive_deleted:number|null};

export class Messages {
 constructor(readonly env:Env,readonly actor:Actor){}
 private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 private visible(alias='m'):[string,unknown[]]{
  return [`(${alias}.task_id IS NULL OR EXISTS(SELECT 1 FROM work_tasks mt LEFT JOIN archives ma ON ma.id=mt.archive_id WHERE mt.id=${alias}.task_id AND (mt.archive_id IS NULL OR ma.deleted=0 OR ?='admin')))` ,[this.actor.role]];
 }
 private active(alias='m'){
  return `(${alias}.task_id IS NULL OR (${alias}.kind='task_deadline_reminder' AND t.status='open' AND t.owner_id=${alias}.recipient_id AND t.version=${alias}.task_version AND t.deadline_at=${alias}.deadline_at AND t.deadline_at>? OR ${alias}.kind='task_expired_uncompleted' AND t.status='expired' AND t.owner_id=${alias}.recipient_id AND t.version=${alias}.task_version OR ${alias}.kind='archive_status_changed' AND t.status='open' AND t.owner_id=${alias}.recipient_id AND t.version=${alias}.task_version))`;
 }
 async list(input:unknown={}){
  const a=messageListInput.parse(input),visibility=this.visible(),where=[`m.recipient_id=?`,`EXISTS(SELECT 1 FROM members recipient WHERE recipient.id=m.recipient_id AND recipient.frozen=0)`,`(${this.active('m')})`,visibility[0]];
  const args:unknown[]=[this.actor.id,now(),...visibility[1]];
  if(a.unread){where.push('m.read_at IS NULL');}
  const rows=await this.stmt(`SELECT m.*,t.status task_status,t.owner_id task_owner_id,t.deadline_at task_deadline_at,t.archive_id,ar.name archive_name,ar.deleted archive_deleted
    FROM messages m LEFT JOIN work_tasks t ON t.id=m.task_id LEFT JOIN archives ar ON ar.id=t.archive_id
    WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC,m.id DESC LIMIT ?`,...args,a.limit).all<MessageRow>();
  return {messages:rows.results.map(row=>({id:row.id,kind:row.kind,task_id:row.task_id,object_type:row.object_type,object_id:row.object_id,title:row.title,body:row.body,deadline_at:row.deadline_at,created_at:row.created_at,read_at:row.read_at,read:!!row.read_at,task_status:row.task_status,archive_id:row.archive_id,archive_name:row.archive_name}))};
 }
 async summary(){
  const visibility=this.visible(),row=await this.stmt(`SELECT count(*) total FROM messages m LEFT JOIN work_tasks t ON t.id=m.task_id WHERE m.recipient_id=? AND EXISTS(SELECT 1 FROM members recipient WHERE recipient.id=m.recipient_id AND recipient.frozen=0) AND m.read_at IS NULL AND ${this.active('m')} AND ${visibility[0]}`,this.actor.id,now(),...visibility[1]).first<{total:number}>();
  return {total:Number(row?.total??0)};
 }
 async markRead(input:unknown){
  const a=messageReadInput.parse(input),visibility=this.visible('m'),ids=JSON.stringify([...new Set(a.ids)]),at=now();
  const result=await this.stmt(`UPDATE messages SET read_at=coalesce(?,read_at) WHERE id IN (SELECT m.id FROM messages m LEFT JOIN work_tasks t ON t.id=m.task_id WHERE m.recipient_id=? AND EXISTS(SELECT 1 FROM members recipient WHERE recipient.id=m.recipient_id AND recipient.frozen=0) AND m.id IN (SELECT value FROM json_each(?)) AND ${this.active('m')} AND ${visibility[0]})`,at,this.actor.id,ids,at,...visibility[1]).run();
  return {ids:[...new Set(a.ids)],marked:Number(result.meta?.changes??0)};
 }
}
