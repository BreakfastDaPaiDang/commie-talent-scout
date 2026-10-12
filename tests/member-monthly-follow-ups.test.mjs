import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {Observations} from '../app/server/observations.ts';
import {generateMemberMonthlyFollowUps,generateScheduledMemberMonthlyFollowUps as generate} from '../app/server/member-monthly-follow-ups.ts';
import {memberMonth,memberMonthlyRule} from '../app/rules/member-monthly-follow-up.ts';
import {zaojiSubject} from '../app/rules/service-subjects.ts';
const setup=t=>{const f=fixture();t.after(f.close);return f;};
const member=async(f,extra={})=>new Archives(f.env,f.actor,'web').create({type:'person',name:'虚构正式社员',status:'已入伙',request_id:uuid(),...extra});
const oct='2026-10-01T00:17:00.000+08:00';
test('month follows China midnight, year boundary and leap February',()=>{
 assert.equal(memberMonth('2026-09-30T15:59:59.999Z').key,'2026-09');assert.deepEqual(memberMonth('2026-09-30T16:00:00.000Z'),{key:'2026-10',title:'10月人事跟进',deadline:'2026-10-31T15:59:59.999Z'});
 assert.equal(memberMonth('2026-12-31T16:00:00.000Z').key,'2027-01');assert.equal(memberMonth('2028-02-01T00:00:00.000Z').deadline,'2028-02-29T15:59:59.999Z');
});
test('monthly uses formal archives including leave/unreachable, never external, org, accounts, closed or deleted',async t=>{
 const f=setup(t);for(const member_status of ['可接工作','请假','失联'])await member(f,{member_status});
 await member(f,{status:'个人接触'});await member(f,{type:'org',status:'个人接触'});
 const closed=await member(f),deleted=await member(f);f.sqlite.prepare('UPDATE archives SET closed=1 WHERE id=?').run(closed.id);f.sqlite.prepare('UPDATE archives SET deleted=1 WHERE id=?').run(deleted.id);
 const result=await generate(f.env,oct);assert.equal(result.created_count,3);assert.equal(result.pending_count,0);
 const tasks=f.sqlite.prepare('SELECT * FROM work_tasks').all();for(const task of tasks){assert.equal(task.kind,'monthly');assert.equal(task.period_key,'2026-10');assert.equal(task.automation_rule,memberMonthlyRule);assert.equal(task.priority,'P2');assert.equal(task.owner_id,null);assert.equal(task.status,'open');assert.equal(task.initiator_id,zaojiSubject.id);assert.equal(task.created_by,zaojiSubject.id);assert.equal(task.initiator_kind,'system');assert.equal(task.deadline_at,'2026-10-31T15:59:59.999Z');}
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_task_events WHERE actor_id=? AND source=?').get(zaojiSubject.id,'system').n,3);
 assert.equal((await generate(f.env,oct)).created_count,0);
 f.sqlite.prepare("UPDATE work_tasks SET status='completed'").run();assert.equal((await generate(f.env,oct)).created_count,0);
 assert.equal(f.sqlite.prepare('SELECT username FROM members WHERE id=?').get(zaojiSubject.id).username,'saki-hr');
});
test('new month preserves overdue work, observations do not auto-complete, leaving/deleting cancels applicable tasks',async t=>{
 const f=setup(t),a=await member(f),archives=new Archives(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'web');
 const first=(await generate(f.env,oct)).tasks[0];await new Observations(f.env,f.actor,'web').create({archive_id:a.id,body:'如实记录本月联系情况',request_id:uuid()});assert.equal((await tasks.detail(first.id)).task.status,'open');
 assert.equal((await generate(f.env,'2026-11-01T00:17:00+08:00')).created_count,1);assert.equal((await tasks.detail(first.id)).task.status,'open');
 const current=await archives.get(a.id);await archives.setState({id:a.id,expected_version:current.version,status:'外部社友',membership_action:'to_friend',member_ids:[],request_id:uuid()});assert.ok((await tasks.list({archive_id:a.id,state:'all'})).tasks.every(t=>t.status==='cancelled'));
 assert.equal((await generate(f.env,'2026-12-01T00:17:00+08:00')).created_count,0);
 const b=await member(f);await generate(f.env,oct);f.actor.role='admin';f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);await archives.setDeleted({id:b.id,expected_version:b.version,request_id:uuid()},true);assert.equal((await tasks.list({archive_id:b.id,state:'all'})).tasks[0].status,'cancelled');
});
test('scheduled and admin calls dedupe, recheck identity/freeze and roll task back when event fails',async t=>{
 const f=setup(t),a=await member(f),batch=f.env.DB.batch;let inject=true;
 f.env.DB.batch=async statements=>{if(inject){inject=false;await generate(f.env,oct);}return batch(statements);};assert.equal((await generate(f.env,oct)).created_count,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_task_events').get().n,1);
 f.env.DB.batch=batch;const b=await member(f);inject=true;f.env.DB.batch=async statements=>{if(inject){inject=false;f.sqlite.prepare("UPDATE archives SET person_role='external',status='外部社友',version=version+1 WHERE id=?").run(b.id);}return batch(statements);};assert.equal((await generate(f.env,oct)).created_count,0);f.env.DB.batch=batch;
 await member(f);f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(zaojiSubject.id);assert.equal((await generate(f.env,oct)).created_count,0);f.sqlite.prepare('UPDATE members SET frozen=0 WHERE id=?').run(zaojiSubject.id);
 f.sqlite.exec("CREATE TRIGGER reject_monthly_event BEFORE INSERT ON work_task_events BEGIN SELECT RAISE(ABORT,'fixture event failure'); END;");await assert.rejects(generate(f.env,oct),/fixture event failure/);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,1);f.sqlite.exec('DROP TRIGGER reject_monthly_event');
 await assert.rejects(generateMemberMonthlyFollowUps(f.env,f.actor,{request_id:uuid()}),{code:'ADMIN_REQUIRED'});f.actor.role='admin';f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);
 const request={request_id:uuid()},first=await generateMemberMonthlyFollowUps(f.env,f.actor,request),again=await generateMemberMonthlyFollowUps(f.env,f.actor,request);assert.equal(again.replayed,true);assert.deepEqual(again.tasks,first.tasks);assert.equal((await generate(f.env)).created_count,0);
});
test('bounded batches drain all members and a later join gets only the current month',async t=>{
 const f=setup(t);for(let i=0;i<45;i++)await member(f,{name:'虚构批量社员'+i});
 assert.equal((await generate(f.env,oct)).created_count,40);assert.equal((await generate(f.env,oct)).created_count,5);assert.equal((await generate(f.env,oct)).created_count,0);
 await member(f,{name:'虚构月中入社'});assert.equal((await generate(f.env,'2026-10-20T12:00:00+08:00')).created_count,1);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,46);
});
