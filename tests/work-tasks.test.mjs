import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {WorkTasks} from '../app/server/work-tasks.ts';

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
