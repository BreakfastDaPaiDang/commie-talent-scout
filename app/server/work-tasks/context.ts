import {now,uid,type Env,type Actor} from '../types.ts';
import type {Source} from '../commands.ts';
export function createTaskContext(env:Env,actor:Actor,source:Source){
 const stmt=(sql:string,...args:unknown[])=>env.DB.prepare(sql).bind(...args);
 const event=(task:string,kind:string,before:unknown,after:unknown,reason?:string)=>stmt('INSERT INTO work_task_events(id,task_id,actor_id,source,kind,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),task,actor.id,source,kind,before?JSON.stringify(before):null,after?JSON.stringify(after):null,reason??null,now());
 return {env,actor,source,stmt,event};
}
export type ServiceContext=ReturnType<typeof createTaskContext>;
