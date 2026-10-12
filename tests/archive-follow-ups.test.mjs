import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {generateArchiveFollowUps,generateScheduledArchiveFollowUps} from '../app/server/archive-follow-ups.ts';
import {archiveReminder,DAY_MS} from '../app/rules/archive-reminders.ts';

function setup(t){const f=fixture();t.after(f.close);f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';return f;}
async function subject(f,{type='person',status='个人接触',days=31}={}){
 const a=await new Archives(f.env,f.actor,'web').create({type,name:'虚构跟进对象',status,member_ids:[],request_id:uuid()});
 f.sqlite.prepare('UPDATE archives SET updated_at=? WHERE id=?').run(new Date(Date.now()-days*DAY_MS).toISOString(),a.id);return a.id;
}
test('follow-up eligibility matches archive reminders, excludes member/closed/deleted and honours strict time boundary',async t=>{
 const f=setup(t),person=await subject(f),org=await subject(f,{type:'org',status:'视奸观察'}),audit=await subject(f,{status:'人事审核',days:8});
 await subject(f,{status:'已入伙'});await subject(f,{status:'已弃用'});await subject(f,{days:1});
 const deleted=await subject(f);f.sqlite.prepare('UPDATE archives SET deleted=1 WHERE id=?').run(deleted);
 const boundary=await subject(f),at=new Date().toISOString();f.sqlite.prepare('UPDATE archives SET updated_at=? WHERE id=?').run(new Date(Date.parse(at)-30*DAY_MS).toISOString(),boundary);
 const originals=f.sqlite.prepare('SELECT * FROM archives').all();
 const result=await generateScheduledArchiveFollowUps(f.env,at);assert.equal(result.created_count,3);
 assert.deepEqual(result.tasks.map(x=>x.archive_id).sort(),[person,org,audit].sort());
 for(const row of originals){assert.equal(result.tasks.some(x=>x.archive_id===row.id),archiveReminder({...row,closed:!!row.closed,deleted:!!row.deleted},Date.parse(at)).overdue);}
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM archives').all(),originals,'generation must not clear the reminder by touching the archive');
 const task=f.sqlite.prepare('SELECT * FROM work_tasks WHERE automation_rule IS NOT NULL LIMIT 1').get();assert.equal(task.owner_id,null);assert.equal(task.priority,'P2');assert.equal(task.initiator_kind,'system');assert.equal(task.initiator_id,null);assert.equal(Date.parse(task.deadline_at)-Date.parse(at),7*DAY_MS);
 const detail=await new WorkTasks(f.env,f.actor,'mcp').detail(task.id);assert.equal(detail.task.initiator_name,'早纪（人事版）');assert.equal(detail.task.initiator_avatar_key,'zaoji-hr');assert.equal(detail.events[0].source,'system');assert.equal(detail.events[0].actor_id,null);
 assert.equal((await generateScheduledArchiveFollowUps(f.env,new Date(Date.parse(at)+1).toISOString())).created_count,1,'one millisecond past the boundary qualifies');
});
test('one task per reminder cycle, no stacked open follow-up, later stale cycle works after manual completion',async t=>{
 const f=setup(t),id=await subject(f),request={archive_ids:[id],request_id:uuid()};
 const first=await generateArchiveFollowUps(f.env,f.actor,request),taskId=first.tasks[0].id;assert.equal(first.created_count,1);
 assert.equal((await generateArchiveFollowUps(f.env,f.actor,request)).tasks[0].id,taskId);
 assert.equal((await generateScheduledArchiveFollowUps(f.env)).created_count,0);
 f.sqlite.prepare("UPDATE work_tasks SET status='cancelled' WHERE id=?").run(taskId);
 assert.equal((await generateScheduledArchiveFollowUps(f.env)).created_count,0,'cancel does not regenerate unchanged reminder');
 f.sqlite.prepare("UPDATE work_tasks SET status='open' WHERE id=?").run(taskId);
 f.sqlite.prepare('UPDATE archives SET updated_at=?,version=version+1 WHERE id=?').run(new Date(Date.now()-32*DAY_MS).toISOString(),id);
 assert.equal((await generateScheduledArchiveFollowUps(f.env)).created_count,0,'changed cycle does not stack on old open work');
 f.sqlite.prepare("UPDATE work_tasks SET status='completed' WHERE id=?").run(taskId);
 assert.equal((await generateScheduledArchiveFollowUps(f.env)).created_count,1);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks WHERE archive_id=?').get(id).n,2);
});
test('scheduler needs no live credentials, backfill requires current admin authority and honours requested IDs',async t=>{
 const f=setup(t),id=await subject(f);await subject(f);
 assert.equal((await generateArchiveFollowUps(f.env,f.actor,{archive_ids:[id],request_id:uuid()})).created_count,1);
 await assert.rejects(()=>generateArchiveFollowUps(f.env,{...f.actor,role:'member'},{request_id:uuid()}),{code:'ADMIN_REQUIRED'});
 f.sqlite.prepare('UPDATE credentials SET revoked_at=?').run(new Date().toISOString());
 await assert.rejects(()=>generateArchiveFollowUps(f.env,f.actor,{request_id:uuid()}),{code:'PRECONDITION_CHANGED'});
 assert.equal((await generateScheduledArchiveFollowUps(f.env)).created_count,1);
});
test('closing the archive leaves the follow-up open for explicit delivery and stops new generation',async t=>{
 const f=setup(t),id=await subject(f),s=new WorkTasks(f.env,f.actor,'web'),archives=new Archives(f.env,f.actor,'web');
 const generated=await generateScheduledArchiveFollowUps(f.env),taskId=generated.tasks[0].id;
 await s.claim({id:taskId,expected_version:1,request_id:uuid()});
 const a=await archives.get(id);await archives.setState({id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:uuid()});
 const current=(await s.detail(taskId)).task;assert.equal(current.status,'open');
 await s.complete({id:taskId,expected_version:current.version,result_kind:'discarded',result_text:'已核对并决定不再跟进，档案已关闭',request_id:uuid()});
 assert.equal((await s.detail(taskId)).task.status,'completed');assert.equal((await generateScheduledArchiveFollowUps(f.env)).created_count,0);
});
test('transaction rechecks archive changes and competing generators; failed event rolls task back',async t=>{
 const f=setup(t),id=await subject(f),batch=f.env.DB.batch;let inject=true;
 f.env.DB.batch=async statements=>{if(inject){inject=false;f.sqlite.prepare('UPDATE archives SET updated_at=?,version=version+1 WHERE id=?').run(new Date().toISOString(),id);}return batch(statements);};
 assert.equal((await generateScheduledArchiveFollowUps(f.env)).created_count,0);
 f.sqlite.prepare('UPDATE archives SET updated_at=? WHERE id=?').run(new Date(Date.now()-31*DAY_MS).toISOString(),id);
 inject=true;f.env.DB.batch=async statements=>{if(inject){inject=false;await generateScheduledArchiveFollowUps(f.env);}return batch(statements);};
 assert.equal((await generateScheduledArchiveFollowUps(f.env)).created_count,0,'competing invocation wins exactly once');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_task_events').get().n,1);
 await subject(f);f.env.DB.batch=batch;
 f.sqlite.exec("CREATE TRIGGER fail_followup_event BEFORE INSERT ON work_task_events BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
 await assert.rejects(()=>generateScheduledArchiveFollowUps(f.env),/fixture failure/);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,1);
});
