import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fixture} from './d1-fixture.mjs';
import {zaojiSubject} from '../app/rules/service-subjects.ts';
import {Archives} from '../app/server/archives.ts';
import {Members} from '../app/server/members.ts';
import {Avatars} from '../app/server/avatars.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {generateScheduledArchiveFollowUps} from '../app/server/archive-follow-ups.ts';
import {login} from '../app/server/auth.ts';

function setup(t){const f=fixture();t.after(f.close);f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';return f;}

test('service identity belongs to account management, not member archives; password auth remains separate from service participation',async t=>{
 const f=setup(t),members=new Members(f.env,f.actor,'web');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM archives').get().n,0);
 assert.equal((await members.directory({})).members.some(m=>m.id===zaojiSubject.id),true);
 const identity=(await members.list({state:'active'})).members.find(m=>m.id===zaojiSubject.id);assert.equal(identity.identity_kind,'service');assert.equal(identity.frozen,false);
 assert.equal((await members.detail(identity.id)).member.identity_kind,'service');
 await assert.rejects(()=>members.setRole({id:identity.id,expected_version:1,role:'admin',request_id:uuid()}),{code:'SERVICE_ROLE_FIXED'});
 await assert.rejects(()=>members.resetPassword({id:identity.id,expected_version:1,temporary_password:'this-is-not-a-service-password',request_id:uuid()}),{code:'SERVICE_AUTH_UNSUPPORTED'});
 assert.throws(()=>f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(identity.id),/service identity/);
 assert.throws(()=>f.sqlite.prepare('UPDATE credentials SET member_id=?').run(identity.id),/immutable/);
 await assert.rejects(()=>login(new Request('https://fixture.invalid/api/auth/login'),f.env,{username:'zaoji-hr',password:'!service-no-password'}),{code:'INVALID_LOGIN'});
 const task=await new WorkTasks(f.env,f.actor,'web').create({kind:'custom',title:'人工任务',purpose:'目的',delivery:'交付',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 assert.equal((await new WorkTasks(f.env,f.actor,'web').assign({id:task.id,expected_version:1,member_id:identity.id,reason:'显式交给服务执行者',request_id:uuid()})).owner_id,identity.id);
 const events=(await members.history(identity.id)).events;assert.equal(events[0].source,'system');assert.equal(JSON.parse(events[0].after_json).origin,'migration:0030');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM credentials WHERE member_id=?').get(identity.id).n,0);
});

test('scheduler needs no admin account; disabling the service pauses generation and profiles/avatars use account identity',async t=>{
 const f=setup(t),members=new Members(f.env,f.actor,'web'),archives=new Archives(f.env,f.actor,'web');
 const target=await archives.create({type:'person',name:'虚构待接触者',status:'个人接触',request_id:uuid()});
 f.sqlite.prepare("UPDATE archives SET updated_at='2020-01-01T00:00:00.000Z'").run();
 await members.setFrozen({id:zaojiSubject.id,expected_version:1,frozen:true,request_id:uuid()});assert.equal((await generateScheduledArchiveFollowUps(f.env)).created_count,0);
 await members.setFrozen({id:zaojiSubject.id,expected_version:2,frozen:false,request_id:uuid()});
 await members.updateProfile({id:zaojiSubject.id,expected_version:3,name:'早纪（人事版）·测试',qq:null,request_id:uuid()});
 f.sqlite.prepare("UPDATE members SET role='member' WHERE identity_kind='human'").run();f.actor.role='member';
 const generated=await generateScheduledArchiveFollowUps(f.env);assert.equal(generated.created_count,1);assert.equal(generated.tasks[0].archive_id,target.id);
 const tasks=new WorkTasks(f.env,f.actor,'mcp'),task=(await tasks.detail(generated.tasks[0].id)).task;
 assert.equal(task.initiator_id,zaojiSubject.id);assert.equal(task.created_by,zaojiSubject.id);assert.equal(task.initiator_name,'早纪（人事版）·测试');assert.equal(task.initiator_version,4);
 assert.equal((await tasks.list({})).tasks.find(t=>t.id===task.id).initiator_version,4);
 const original=readFileSync('public/art/zaoji-hr.png');let requested;
 f.env.ASSETS={async fetch(request){requested=new URL(request.url).pathname;return new Response(original,{headers:{'Content-Type':'image/png'}});}};
 const avatars=new Avatars(f.env,f.actor,'mcp'),response=await avatars.read('member',zaojiSubject.id);assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);assert.equal(requested,'/art/zaoji-hr.png');
 f.env.ASSETS.fetch=async()=>new Response('<html/>',{headers:{'content-type':'text/html'}});
 await assert.rejects(()=>avatars.read('member',zaojiSubject.id),{code:'AVATAR_UNAVAILABLE'});
});

test('freezing between planning and commit prevents the automatic task',async t=>{
 const f=setup(t);await new Archives(f.env,f.actor,'web').create({type:'person',name:'虚构跟进对象',request_id:uuid()});f.sqlite.prepare("UPDATE archives SET updated_at='2020-01-01T00:00:00.000Z'").run();
 const batch=f.env.DB.batch;f.env.DB.batch=async statements=>{f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(zaojiSubject.id);return batch(statements);};
 assert.equal((await generateScheduledArchiveFollowUps(f.env)).created_count,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_task_events').get().n,0);
});

test('identity migration preserves child history and human initiators while correcting legacy system creators',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')&&n<'0030').sort())db.exec(readFileSync('migrations/'+name,'utf8'));
  db.exec("INSERT INTO members(id,username,name,role,password_hash,created_at) VALUES('human','human','人','member','hash','2026-01-01')");
  for(const [id,kind] of [['system-task','system'],['human-task','member']])db.prepare("INSERT INTO work_tasks(id,kind,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at,initiator_kind,initiator_id) VALUES(?,'custom','t','p','d','rule','open','2027-01-01','human','2026-01-01','2026-01-01',?,?)").run(id,kind,kind==='member'?'human':null);
  db.exec("INSERT INTO work_task_events(id,task_id,actor_id,source,kind,created_at) VALUES('old','system-task',NULL,'system','task.created','2026-01-01')");
  db.exec(readFileSync('migrations/0030_service_subjects.sql','utf8'));
  assert.equal(db.prepare("SELECT created_by FROM work_tasks WHERE id='system-task'").get().created_by,zaojiSubject.id);
  assert.equal(db.prepare("SELECT initiator_id FROM work_tasks WHERE id='human-task'").get().initiator_id,'human');
  assert.equal(db.prepare("SELECT actor_id FROM work_task_events WHERE id='old'").get().actor_id,null);
  assert.equal(db.prepare("SELECT count(*) n FROM work_task_events WHERE task_id='system-task'").get().n,2);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});

