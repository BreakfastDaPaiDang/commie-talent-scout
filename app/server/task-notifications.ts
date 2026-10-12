import {planTaskNotifications,taskOverdue,type NotificationTask} from '../rules/task-notifications.ts';
import type {CandidateMember,PushableTaskKind} from '../rules/task-preferences.ts';
import {now,uid,type Env} from './types.ts';

/** Scheduler adapter: system work does not need a human Actor or credential. */
export async function runTaskNotifications(env:Env,mode:'overdue'|'due',at=now()){
 const tasks=await env.DB.prepare("SELECT id,kind,status,owner_id,created_at,deadline_at,version FROM work_tasks WHERE status='open'").all<NotificationTask>();
 let members:CandidateMember[]=[];
 if(mode==='due'){
  const rows=await env.DB.prepare('SELECT m.id,m.name,m.frozen,p.all_work,p.kinds_json FROM members m LEFT JOIN member_work_preferences p ON p.member_id=m.id WHERE m.frozen=0').all<{id:string;name:string;frozen:number;all_work:number|null;kinds_json:string|null}>();
  members=rows.results.map(m=>({id:m.id,name:m.name,frozen:!!m.frozen,preference:m.all_work===null?null:{memberId:m.id,all:!!m.all_work,kinds:JSON.parse(m.kinds_json??'[]') as PushableTaskKind[]}}));
 }
 const statements=tasks.results.flatMap(task=>planTaskNotifications({task,members,at,mode,uid,stmt:(sql,...args)=>env.DB.prepare(sql).bind(...args)}).statements);
 let count=0;
 // Each statement is independently idempotent; keep batches within D1 limits.
 for(let i=0;i<statements.length;i+=40){
  const results=await env.DB.batch(statements.slice(i,i+40));
  count+=results.reduce((n,r)=>n+(r.meta.changes??0),0);
 }
 return {count,reminded:count,overdue_count:tasks.results.filter(task=>taskOverdue(task,at)).length};
}
