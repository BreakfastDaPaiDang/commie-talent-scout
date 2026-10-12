import {z} from 'zod';
import {assertAdmin} from './credentials.ts';
import {command,requestId} from './commands.ts';
import {memberArchiveSql} from '../rules/person-identity.ts';
import {memberMonth,planMemberMonthly,type MonthlyTarget} from '../rules/member-monthly-follow-up.ts';
import {now,uid,type Actor,type Env} from './types.ts';

export const memberMonthlyInput=z.object({archive_ids:z.array(z.uuid()).min(1).max(50).optional(),request_id:requestId}).strict();
async function prepare(env:Env,at:string,archiveIds?:string[]){
 const month=memberMonth(at),filter=archiveIds?'AND a.id IN (SELECT value FROM json_each(?))':'';
 const targets=await env.DB.prepare(`SELECT a.* FROM archives a WHERE ${memberArchiveSql()} AND a.closed=0 AND a.deleted=0 ${filter}
  AND NOT EXISTS(SELECT 1 FROM work_tasks t WHERE t.archive_id=a.id AND t.kind='monthly' AND t.period_key=?)
  ORDER BY a.id LIMIT 40`).bind(...(archiveIds?[JSON.stringify(archiveIds)]:[]),month.key).all<MonthlyTarget>();
 return targets.results.map(target=>{
  const taskId=uid(),plan=planMemberMonthly({target:{...target,closed:!!target.closed,deleted:!!target.deleted},at,taskId,eventId:uid(),stmt:(sql,...args)=>env.DB.prepare(sql).bind(...args)});
  return {taskId,statements:plan.statements};
 });
}
async function summary(env:Env,ids:string[],period:string){
 const tasks=ids.length?(await env.DB.prepare('SELECT id,archive_id,period_key,deadline_at FROM work_tasks WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all()).results:[];
 const pending=await env.DB.prepare(`SELECT count(*) n FROM archives a WHERE ${memberArchiveSql()} AND a.closed=0 AND a.deleted=0
 AND NOT EXISTS(SELECT 1 FROM work_tasks t WHERE t.archive_id=a.id AND t.kind='monthly' AND t.period_key=?)`).bind(period).first<number>('n');
 return {period,created_count:tasks.length,changed:tasks.length>0,tasks,pending_count:pending??0};
}
export async function generateMemberMonthlyFollowUps(env:Env,actor:Actor,input:unknown){
 assertAdmin(actor);const a=memberMonthlyInput.parse(input);
 const result=await command(env,actor,{requestId:a.request_id,operation:'work_task.generate_member_monthly',parameters:{archive_ids:a.archive_ids},requireAdmin:true},async()=>{
  const at=now(),plans=await prepare(env,at,a.archive_ids);
  return {result:{period:memberMonth(at).key,task_ids:plans.map(p=>p.taskId)},statements:plans.flatMap(p=>p.statements)};
 });
 return {...await summary(env,result.task_ids,result.period),...('replayed' in result?{replayed:result.replayed}:{})};
}
export async function generateScheduledMemberMonthlyFollowUps(env:Env,at=now()){
 const plans=await prepare(env,at),ids:string[]=[];
 for(const plan of plans){await env.DB.batch(plan.statements);ids.push(plan.taskId);}
 return summary(env,ids,memberMonth(at).key);
}
