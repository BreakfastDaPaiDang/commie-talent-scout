import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {runTaskNotifications} from '../app/server/task-notifications.ts';
import {planTaskNotifications,taskDeadlineSoon,taskOverdue,TASK_REMINDER_WINDOW_MS} from '../app/rules/task-notifications.ts';

test('system reminder works without any live human credential and repeated dispatch is idempotent',async t=>{
 const f=fixture();t.after(f.close);const tasks=new WorkTasks(f.env,f.actor,'web');
 const task=await tasks.create({kind:'audit',title:'跟进',purpose:'核对',delivery:'留档',deadline_at:'2099-01-03T00:00:00.000Z',request_id:uuid()});
 await tasks.claim({id:task.id,expected_version:task.version,request_id:uuid()});
 f.sqlite.prepare('DELETE FROM credentials').run();
 assert.equal((await runTaskNotifications(f.env,'due','2099-01-02T00:00:00.000Z')).count,1);
 assert.equal((await runTaskNotifications(f.env,'due','2099-01-02T00:00:00.000Z')).count,0);
 assert.equal((await runTaskNotifications(f.env,'overdue','2099-01-03T00:00:00.000Z')).count,1);
 assert.equal((await runTaskNotifications(f.env,'overdue','2099-01-03T00:00:00.000Z')).count,0);
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(task.id).status,'open');
});

test('planned reminders do not leak stale assignment/deadline and skip frozen recipients',async t=>{
 const f=fixture();t.after(f.close);const tasks=new WorkTasks(f.env,f.actor,'web');
 const task=await tasks.create({kind:'audit',title:'期限竞态',purpose:'核对',delivery:'留档',deadline_at:'2099-01-03T00:00:00.000Z',request_id:uuid()});
 await tasks.claim({id:task.id,expected_version:task.version,request_id:uuid()});
 const old=f.sqlite.prepare('SELECT * FROM work_tasks WHERE id=?').get(task.id);
 const context={task:old,members:[],at:'2099-01-02T12:00:00.000Z',mode:'due',uid:uuid,stmt:(sql,...args)=>f.env.DB.prepare(sql).bind(...args)};
 const plan=planTaskNotifications(context);
 f.sqlite.prepare('UPDATE work_tasks SET version=version+1,deadline_at=? WHERE id=?').run('2099-02-01T00:00:00.000Z',task.id);
 await f.env.DB.batch(plan.statements);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM messages').get().n,0);
 f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.actor.id);
 assert.equal((await runTaskNotifications(f.env,'overdue','2099-02-02T00:00:00.000Z')).count,0);
});

test('deadline boundary means overdue at deadline and never closes a task',()=>{
 const at='2099-01-01T00:00:00.000Z',task={status:'open',deadline_at:at};
 assert.equal(taskOverdue(task,at),true);assert.equal(taskDeadlineSoon(task,at),false);
 assert.equal(taskDeadlineSoon({...task,deadline_at:new Date(Date.parse(at)+TASK_REMINDER_WINDOW_MS).toISOString()},at),true);
 assert.equal(taskOverdue({...task,status:'completed'},at),false);
});

test('a recommendation plan rechecks claim and preference changes when it is committed',async t=>{
 const f=fixture();t.after(f.close);const tasks=new WorkTasks(f.env,f.actor,'web');
 const task=await tasks.create({kind:'audit',title:'推荐竞态',purpose:'核对',delivery:'留档',deadline_at:'2099-01-03T00:00:00.000Z',request_id:uuid()});
 f.sqlite.prepare("INSERT INTO member_work_preferences(member_id,all_work,kinds_json,created_at,updated_at) VALUES(?,1,'[]',?,?)").run(f.actor.id,task.created_at,task.created_at);
 const c={task,members:[{id:f.actor.id,name:'测试成员',frozen:false,preference:{memberId:f.actor.id,all:true,kinds:[]}}],at:task.created_at,mode:'due',uid:uuid,stmt:(sql,...args)=>f.env.DB.prepare(sql).bind(...args)};
 const plan=planTaskNotifications(c);
 assert.equal(plan.statements.length,1);
 f.sqlite.prepare('UPDATE member_work_preferences SET all_work=0 WHERE member_id=?').run(f.actor.id);
 await f.env.DB.batch(plan.statements);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_task_pushes').get().n,0);
 f.sqlite.prepare('UPDATE member_work_preferences SET all_work=1 WHERE member_id=?').run(f.actor.id);
 await tasks.claim({id:task.id,expected_version:task.version,request_id:uuid()});
 await f.env.DB.batch(plan.statements);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_task_pushes').get().n,0);
});
