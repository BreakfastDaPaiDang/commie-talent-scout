import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Notifications} from '../app/server/notifications.ts';
import {Archives} from '../app/server/archives.ts';
import {Reading} from '../app/server/reading.ts';
import {ArchiveReading} from '../app/server/archive-reading.ts';
import {Messages} from '../app/server/messages.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {registerMessageTools} from '../app/server/mcp-messages.ts';

function writer(f){const id=uuid();f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,'2020-01-01')").run(id,id,'消息作者');const credential=uuid();f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'mcp','test',1,'2020-01-01','2099-01-01')").run(credential,id,uuid());return {...f.actor,id,credential_id:credential};}
async function archive(f){return new Archives(f.env,writer(f),'web').create({type:'person',name:'消息关联档案',request_id:uuid()});}
async function reminder(f){const s=new WorkTasks(f.env,f.actor,'web'),task=await s.create({kind:'custom',title:'统一提醒测试',purpose:'真实任务',delivery:'结果留档',deadline_at:new Date(Date.now()+3600000).toISOString(),request_id:uuid()}),owned=await s.claim({id:task.id,expected_version:task.version,request_id:uuid()});await s.duePushes(new Date().toISOString());return {s,task:owned};}

test('one feed, one count and source-specific confirmations share legacy read state without business writes',async t=>{
 const f=fixture();t.after(f.close);const a=await archive(f),{task}=await reminder(f),n=new Notifications(f.env,f.actor);
 const page=await n.list({unread:true});assert.equal(page.notifications.length,2);assert.deepEqual(await n.summary(),{total:2,reading:1,messages:1});
 assert.equal((await n.list({source:'archive'})).notifications[0].data.archive_id,a.id);
 const message=page.notifications.find(n=>n.source==='task'),event=page.notifications.find(n=>n.source==='archive');
 assert.equal(event.recipient_id,f.actor.id);assert.equal(event.confirmation,'content_receipt');
 await assert.rejects(n.confirm({mode:'message',ids:[event.id]}));
 assert.equal((await n.summary()).total,2,'metadata and invalid raw archive ID do not read content');
 const before=f.sqlite.prepare('SELECT * FROM work_tasks WHERE id=?').get(task.id);
 await n.confirm({mode:'message',ids:[message.id]});const readAt=(await n.list({source:'task'})).notifications[0].read_at;
 await new Messages(f.env,f.actor).markRead({ids:[message.source_id]});
 assert.equal((await n.list({source:'task'})).notifications[0].read_at,readAt,'retry preserves first read time');
 assert.equal((await new Messages(f.env,f.actor).summary()).total,0);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM work_tasks WHERE id=?').get(task.id),before);
 const delivery=await new ArchiveReading(f.env,f.actor).deliver(a.id);
 await n.confirm({mode:'archive',ticket:delivery.ticket});
 assert.deepEqual(await n.summary(),{total:0,reading:0,messages:0});assert.equal((await new Reading(f.env,f.actor).summary()).total,0);
 assert.equal((await n.list({unread:'false'})).notifications.length,2,'false query string includes read items');
});

test('mixed pagination holds a snapshot through new events, equal timestamps and read acknowledgements',async t=>{
 const f=fixture();t.after(f.close);for(let i=0;i<4;i++)await archive(f);await reminder(f);
 f.sqlite.prepare("UPDATE archive_events SET created_at='2090-01-01T00:00:00.000Z'").run();f.sqlite.prepare("UPDATE messages SET created_at='2090-01-01T00:00:00.000Z'").run();
 const n=new Notifications(f.env,f.actor),first=await n.list({limit:2,unread:true}),seen=[...first.notifications];
 const extra=await archive(f);f.sqlite.prepare("UPDATE archive_events SET created_at='2090-01-01T00:00:00.000Z' WHERE archive_id=?").run(extra.id);
 const ticket=await new ArchiveReading(f.env,f.actor).deliver(first.notifications.find(n=>n.source==='archive').data.archive_id);await n.confirm({mode:'archive',ticket:ticket.ticket});
 let cursor=first.next_cursor;while(cursor){const next=await n.list({limit:2,unread:true,snapshot:first.snapshot,cursor});seen.push(...next.notifications);cursor=next.next_cursor;}
 assert.equal(seen.length,5);assert.equal(new Set(seen.map(n=>n.id)).size,5);assert.ok(!seen.some(n=>n.data.archive_id===extra.id));
 assert.equal((await n.list({source:'archive',unread:true})).notifications.length,4);
 await assert.rejects(n.list({cursor:first.next_cursor}),{code:'INVALID_CURSOR'});
});

test('overdue, expiry and visibility use the same predicates in feed, counts and acknowledgement',async t=>{
 const f=fixture();t.after(f.close);const {s,task}=await reminder(f),n=new Notifications(f.env,f.actor);
 f.sqlite.prepare("UPDATE work_tasks SET deadline_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(task.id);await s.expire(new Date().toISOString());
 const page=await n.list();assert.equal(page.notifications.length,1);assert.equal(page.notifications[0].kind,'task_overdue');assert.equal((await n.summary()).messages,1);
 await s.extend({id:task.id,expected_version:task.version,deadline_at:new Date(Date.now()+86400000*3).toISOString(),request_id:uuid()});
 assert.equal((await n.list()).notifications.length,0);assert.equal((await n.confirm({mode:'message',ids:[page.notifications[0].id]})).marked,0);
 await archive(f);f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.actor.id);assert.equal((await n.list()).notifications.length,0);assert.equal((await n.summary()).total,0);
});

test('MCP and web service share notifications and event receipt confirmation',async t=>{
 const f=fixture();t.after(f.close);await archive(f);await reminder(f);const registered=new Map();
 registerMessageTools({registerTool(name,config,run){registered.set(name,{config,run});}},f.env,f.actor,async fn=>fn());
 const n=new Notifications(f.env,f.actor),mcp=await registered.get('list_notifications').run({unread:true});assert.deepEqual(mcp,await n.list({unread:true}));
 const event=mcp.notifications.find(n=>n.source==='archive'),deliveries=await new Reading(f.env,f.actor).deliver([{id:event.source_id}]),ticket=deliveries.get(event.source_id).ticket;
 const other=new Notifications(f.env,{...f.actor,credential_id:uuid()});assert.equal((await other.confirm({mode:'event',tickets:[ticket]})).confirmed.length,0);
 assert.equal((await registered.get('confirm_notifications').run({mode:'event',tickets:[ticket]})).confirmed.length,1);
 assert.equal((await registered.get('get_notification_summary').run()).reading,0);
 assert.equal((await n.summary()).messages,1);
});

test('explicit all-read covers both sources beyond pagination, preserves newer events and business state',async t=>{
 const f=fixture();t.after(f.close);for(let i=0;i<35;i++)await archive(f);const {task}=await reminder(f),n=new Notifications(f.env,f.actor),first=await n.list({unread:true,limit:2});
 const later=await archive(f),prior=f.sqlite.prepare('SELECT * FROM work_tasks WHERE id=?').get(task.id);
 await n.confirm({mode:'all',snapshot:first.snapshot});
 assert.deepEqual(await n.summary(),{total:1,reading:1,messages:0});assert.equal((await n.list({unread:true})).notifications[0].data.archive_id,later.id);
 assert.deepEqual(f.sqlite.prepare('SELECT * FROM work_tasks WHERE id=?').get(task.id),prior);
 assert.equal((await n.confirm({mode:'all',snapshot:first.snapshot})).marked,0);
 await assert.rejects(n.confirm({mode:'all',snapshot:'invalid'}),{code:'INVALID_CURSOR'});
 const pending=await n.list();f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.actor.id);await assert.rejects(n.confirm({mode:'all',snapshot:pending.snapshot}));
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM event_read_marks WHERE event_id=(SELECT id FROM archive_events WHERE archive_id=?)').get(later.id).n,0);
});

test('all-read is personal, skips unavailable archives and rolls both sources back on failure',async t=>{
 const f=fixture();t.after(f.close);const hidden=await archive(f);await archive(f);await reminder(f);const n=new Notifications(f.env,f.actor),page=await n.list();
 f.sqlite.prepare('UPDATE archives SET deleted=1 WHERE id=?').run(hidden.id);
 f.sqlite.exec("CREATE TRIGGER reject_bulk_read BEFORE INSERT ON event_read_marks BEGIN SELECT RAISE(ABORT,'fixture read failure'); END;");
 await assert.rejects(n.confirm({mode:'all',snapshot:page.snapshot}),/fixture read failure/);assert.equal((await n.summary()).messages,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM event_read_marks').get().n,0);
 f.sqlite.exec('DROP TRIGGER reject_bulk_read');await n.confirm({mode:'all',snapshot:page.snapshot});assert.equal((await n.summary()).total,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM event_read_marks WHERE member_id<>?').get(f.actor.id).n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM event_read_marks r JOIN archive_events e ON e.id=r.event_id WHERE e.archive_id=?').get(hidden.id).n,0);
});
