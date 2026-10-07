import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {Messages} from '../app/server/messages.ts';

function future(hours){return new Date(Date.now()+hours*60*60*1000).toISOString();}

test('deadline reminders are owner-scoped, strict, and idempotent',async t=>{
 const f=fixture();t.after(f.close);const tasks=new WorkTasks(f.env,f.actor,'mcp'),deadline=future(12),task=await tasks.create({kind:'custom',title:'负责人任务',purpose:'提交结果',delivery:'结果记录',deadline_at:deadline,request_id:uuid()});
 const claimed=await tasks.claim({id:task.id,expected_version:task.version,request_id:uuid()});
 const at=new Date().toISOString();const first=await tasks.duePushes(at);assert.equal(first.count,1);assert.equal((await tasks.duePushes(at)).count,0);
 const messages=new Messages(f.env,f.actor);assert.equal((await messages.summary()).total,1);const listed=await messages.list({});assert.equal(listed.messages[0].task_id,task.id);
 const before=f.sqlite.prepare('SELECT status,version,deadline_at FROM work_tasks WHERE id=?').get(task.id);await messages.markRead({ids:[listed.messages[0].id]});const after=f.sqlite.prepare('SELECT status,version,deadline_at FROM work_tasks WHERE id=?').get(task.id);assert.deepEqual(after,before);
 const extended=await tasks.extend({id:task.id,expected_version:claimed.version,deadline_at:future(48),request_id:uuid()});assert.equal(extended.version,claimed.version+1);assert.equal((await messages.list({})).messages.length,0,'the old deadline reminder is invalidated by extension');
 f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.actor.id);assert.equal((await messages.list({})).messages.length,0,'frozen recipients cannot read message content');
});

test('deadline processing distinguishes unclaimed and owned expiries without grace',async t=>{
 const f=fixture();t.after(f.close);const tasks=new WorkTasks(f.env,f.actor,'mcp'),unclaimed=await tasks.create({kind:'custom',title:'无人领取',purpose:'等待领取',delivery:'结果记录',deadline_at:future(24),request_id:uuid()});
 f.sqlite.prepare("UPDATE work_tasks SET deadline_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(unclaimed.id);
 const owned=await tasks.create({kind:'custom',title:'已领取',purpose:'提交',delivery:'结果',deadline_at:future(24),request_id:uuid()});const claimed=await tasks.claim({id:owned.id,expected_version:owned.version,request_id:uuid()});
 f.sqlite.prepare("UPDATE work_tasks SET deadline_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(owned.id);
 const result=await tasks.expire('2020-01-02T00:00:00.000Z');assert.equal(result.count,2);
 assert.equal(f.sqlite.prepare('SELECT closed_reason FROM work_tasks WHERE id=?').get(unclaimed.id).closed_reason,'claim_deadline_missed');assert.equal(f.sqlite.prepare('SELECT closed_reason FROM work_tasks WHERE id=?').get(owned.id).closed_reason,'completion_deadline_missed');
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM messages WHERE task_id=? AND kind='task_expired_uncompleted'").get(owned.id).n,1);assert.equal((await tasks.expire('2020-01-03T00:00:00.000Z')).count,0);
 assert.equal(claimed.owner_id,f.actor.id);
});
