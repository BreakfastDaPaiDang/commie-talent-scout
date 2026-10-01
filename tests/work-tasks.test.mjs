import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {Archives} from '../app/server/archives.ts';

test('work task creation is separate from MCP review tasks and can be claimed once',async t=>{
 const f=fixture();t.after(f.close);const service=new WorkTasks(f.env,f.actor,'mcp');
 const created=await service.create({kind:'audit',title:'人事审核',purpose:'了解是否适合继续接触',delivery:'提交观察与结论',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 assert.equal(created.status,'open');assert.equal(created.owner_id,null);
 const listed=await service.list({scope:'all'});assert.equal(listed.tasks.length,1);
 const claimed=await service.claim({id:created.id,expected_version:created.version,request_id:uuid()});assert.equal(claimed.owner_id,f.actor.id);
 await assert.rejects(service.claim({id:created.id,expected_version:created.version,request_id:uuid()}),{code:'VERSION_CONFLICT'});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mcp_tasks').get().n,0);
});

test('due push records only matching active members and never assigns the task',async t=>{
 const f=fixture();t.after(f.close);const memberId=uuid(),at=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,qq,created_at) VALUES(?,?,?,'member','fixture',0,'00000',?)").run(memberId,'recipient','接收人',at);
 f.sqlite.prepare("INSERT INTO member_work_preferences(member_id,all_work,kinds_json,version,created_at,updated_at) VALUES(?,0,'[\"audit\"]',1,?,?)").run(memberId,at,at);
 const service=new WorkTasks(f.env,f.actor,'mcp'),task=await service.create({kind:'audit',title:'审核',purpose:'判断',delivery:'观察记录',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 const pushed=await service.duePushes(task.created_at);assert.equal(pushed.count,1);
 const push=f.sqlite.prepare('SELECT member_id,stage FROM work_task_pushes WHERE task_id=?').get(task.id);assert.equal(push.member_id,memberId);assert.equal(push.stage,'initial');
 assert.equal(f.sqlite.prepare('SELECT owner_id FROM work_tasks WHERE id=?').get(task.id).owner_id,null);
 assert.equal((await service.duePushes(task.created_at)).count,0);
});

test('administrator assignment records a reason and stops the unowned state',async t=>{
 const f=fixture();t.after(f.close);f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';
 const target=uuid(),at=new Date().toISOString();f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,qq,created_at) VALUES(?,?,?,'member','fixture',0,'00000',?)").run(target,'assigned','被指派人',at);
 const service=new WorkTasks(f.env,f.actor,'web'),task=await service.create({kind:'onboarding',title:'入社对接',purpose:'说明后续安排',delivery:'留下交接记录',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 const assigned=await service.assign({id:task.id,member_id:target,expected_version:task.version,reason:'本周负责入社对接',request_id:uuid()});assert.equal(assigned.owner_id,target);
 const event=f.sqlite.prepare("SELECT kind,reason FROM work_task_events WHERE task_id=? ORDER BY created_at DESC LIMIT 1").get(task.id);assert.equal(event.kind,'task.assigned');assert.equal(event.reason,'本周负责入社对接');
});

test('only the current owner can complete or release a task, and both actions keep history',async t=>{
 const f=fixture();t.after(f.close);const service=new WorkTasks(f.env,f.actor,'mcp');
 const task=await service.create({kind:'audit',title:'审核',purpose:'了解情况',delivery:'交代结论',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 await assert.rejects(service.complete({id:task.id,expected_version:task.version,result_kind:'completed',result_text:'尚未接取',request_id:uuid()}),{code:'TASK_OWNER_REQUIRED'});
 const claimed=await service.claim({id:task.id,expected_version:task.version,request_id:uuid()});
 const released=await service.release({id:task.id,expected_version:claimed.version,deadline_at:'2099-02-01T00:00:00.000Z',request_id:uuid()});assert.equal(released.owner_id,null);
 const reclaimed=await service.claim({id:task.id,expected_version:released.version,request_id:uuid()});
 const completed=await service.complete({id:task.id,expected_version:reclaimed.version,result_kind:'unable_to_contact',result_text:'本次未取得联系，保留后续跟进事项。',request_id:uuid()});assert.equal(completed.status,'completed');
 const detail=await service.detail(task.id);assert.deepEqual(detail.events.map(e=>e.kind),['task.completed','task.claimed','task.released','task.claimed','task.created']);
});

test('referral creates an unowned audit task and explicit membership creates onboarding on the same archive',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web'),archive=await archives.create({type:'person',name:'虚构流程对象',status:'个人接触',request_id:uuid()});const service=new WorkTasks(f.env,f.actor,'mcp');
 const referral=await service.refer({archive_id:archive.id,expected_version:archive.version,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});assert.equal(referral.archive_status,'人事审核');assert.equal(f.sqlite.prepare("SELECT owner_id FROM work_tasks WHERE id=?").get(referral.task_id).owner_id,null);
 const claimed=await service.claim({id:referral.task_id,expected_version:1,request_id:uuid()});await service.complete({id:referral.task_id,expected_version:claimed.version,result_kind:'continue',result_text:'对方愿意继续了解组织。',request_id:uuid()});
 const membership=await service.confirmMembership({archive_id:archive.id,expected_version:2,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});assert.equal(membership.archive_status,'已加入待对接');
 const current=await archives.get(archive.id);assert.equal(current.status,'已加入待对接');assert.equal(current.closed,false);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_tasks WHERE archive_id=? AND kind='onboarding' AND status='open'").get(archive.id).n,1);
});
