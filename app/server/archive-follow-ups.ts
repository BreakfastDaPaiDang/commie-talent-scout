import {z} from 'zod';
import {assertAdmin} from './credentials.ts';
import {command,requestId} from './commands.ts';
import {archiveOrderCte} from './archive-order.ts';
import {archiveFollowUpRule,planArchiveFollowUp,type FollowUpTarget} from './rules/archive-follow-up.ts';
import {now,uid,type Actor,type Env} from './types.ts';

export const archiveFollowUpInput=z.object({archive_ids:z.array(z.uuid()).min(1).max(50).optional(),request_id:requestId}).strict();
async function prepareFollowUps(env:Env,at:string,legacyCreatorId:string,archiveIds?:string[]){
 const filter=archiveIds?`AND a.id IN (${archiveIds.map(()=>'?').join(',')})`:'';
 const rows=await env.DB.prepare(`${archiveOrderCte} SELECT a.* FROM ranked a WHERE a._priority=0 ${filter}
  AND NOT EXISTS(SELECT 1 FROM work_tasks t WHERE t.archive_id=a.id AND t.automation_rule=? AND (t.status='open' OR t.automation_key=a.updated_at))
  ORDER BY a._due,a.id LIMIT 40`).bind(Date.parse(at),...(archiveIds??[]),archiveFollowUpRule).all<FollowUpTarget>();
 return rows.results.map(target=>{
  const taskId=uid(),plan=planArchiveFollowUp({target:{...target,closed:!!target.closed,deleted:!!target.deleted},at,taskId,eventId:uid(),legacyCreatorId,stmt:(sql,...args)=>env.DB.prepare(sql).bind(...args)});
  return {taskId,statements:plan.statements};
 }).filter(plan=>plan.statements.length);
}
async function generatedTasks(env:Env,ids:string[]){
 if(!ids.length)return [];
 return (await env.DB.prepare(`SELECT id,archive_id,automation_key,deadline_at FROM work_tasks WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all()).results;
}
/** Admin backfill and scheduled generation use the same planner and business deduplication. */
export async function generateArchiveFollowUps(env:Env,actor:Actor,input:unknown){
 assertAdmin(actor);const a=archiveFollowUpInput.parse(input);
 const result=await command(env,actor,{requestId:a.request_id,operation:'work_task.generate_archive_follow_ups',parameters:{archive_ids:a.archive_ids},requireAdmin:true},async()=>{
  const plans=await prepareFollowUps(env,now(),actor.id,a.archive_ids);
  return {result:{task_ids:plans.map(p=>p.taskId)},statements:plans.flatMap(p=>p.statements)};
 });
 const tasks=await generatedTasks(env,result.task_ids);
 return {created_count:tasks.length,changed:tasks.length>0,tasks,...('replayed' in result?{replayed:result.replayed}:{})};
}
/** No member credential is used. created_by is only the legacy NOT NULL admin reference;
 * the business initiator is zaoji-hr and the event execution source is system (actor NULL). */
export async function generateScheduledArchiveFollowUps(env:Env,at=now()){
 const creator=await env.DB.prepare("SELECT id FROM members WHERE role='admin' ORDER BY id LIMIT 1").first<{id:string}>();
 if(!creator)return {created_count:0,changed:false,tasks:[]};
 const plans=await prepareFollowUps(env,at,creator.id),ids:string[]=[];
 for(const plan of plans){await env.DB.batch(plan.statements);ids.push(plan.taskId);}
 const tasks=await generatedTasks(env,ids);return {created_count:tasks.length,changed:tasks.length>0,tasks};
}
