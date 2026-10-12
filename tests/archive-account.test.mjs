import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Members} from '../app/server/members.ts';
const admin=f=>{f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';};
const create=(f,extra={})=>({type:'person',status:'已入伙',name:'名单原称呼',linked_account_id:f.actor.id,request_id:uuid(),...extra});
const profile=a=>({id:a.id,expected_version:a.version,name:a.name,contacts:a.contacts,links:a.links,request_id:uuid()});
test('person account identity is distinct from responsibility, unique, explicit and replayable',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web');
 await assert.rejects(s.create(create(f)),{code:'ADMIN_REQUIRED'});admin(f);
 const input=create(f),first=await s.create(input),replay=await s.create(input);assert.equal(replay.id,first.id);assert.equal(replay.replayed,true);
 const a=await s.get(first.id);assert.equal(a.name,f.actor.name);assert.equal(a.linked_account_id,f.actor.id);assert.deepEqual(a.members,[]);assert.equal(a.member_status,'可接工作');assert.equal(a.closed,false);
 await assert.rejects(s.create(create(f)),{code:'ACCOUNT_ALREADY_LINKED'});
 await assert.rejects(s.create(create(f,{status:'个人接触'})),{code:'ACCOUNT_LINK_NOT_APPLICABLE'});
 await assert.rejects(s.create(create(f,{type:'org',status:'组织交流'})));
 await assert.rejects(s.create(create(f,{linked_account_id:'00000000-0000-4000-8000-000000000083'})),{code:'HUMAN_ACCOUNT_REQUIRED'});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,0);
 await s.setDeleted({id:a.id,expected_version:a.version,request_id:uuid()},true);
 await assert.rejects(s.create(create(f)),{code:'ACCOUNT_ALREADY_LINKED'});
});
test('account rename synchronizes archive and search atomically, preserves history and contact clock',async t=>{
 const f=fixture();t.after(f.close);admin(f);const s=new Archives(f.env,f.actor,'mcp'),members=new Members(f.env,f.actor,'web');
 const created=await s.create(create(f,{contacts:[{type:'QQ',value:'12345678',note:'名单称呼：原昵称'}]}));let a=await s.get(created.id);
 await assert.rejects(s.update({...profile(a),name:'独立改名'}),{code:'ACCOUNT_NAME_MANAGED'});
 const rename={id:f.actor.id,expected_version:1,name:'账号新昵称',qq:'87654321',request_id:uuid()};
 f.sqlite.exec("CREATE TRIGGER reject_synced_archive BEFORE UPDATE OF name ON archives BEGIN SELECT RAISE(ABORT,'injected'); END;");
 await assert.rejects(members.updateProfile(rename));assert.equal((await s.get(a.id)).name,f.actor.name);assert.equal(f.sqlite.prepare('SELECT name FROM members WHERE id=?').get(f.actor.id).name,f.actor.name);
 f.sqlite.exec('DROP TRIGGER reject_synced_archive');await members.updateProfile({...rename,request_id:uuid()});
 const next=await s.get(a.id);assert.equal(next.name,'账号新昵称');assert.equal(next.version,a.version+1);assert.equal(next.updated_at,a.updated_at);assert.deepEqual(next.contacts,a.contacts);assert.equal(next.linked_account_id,f.actor.id);
 assert.equal((await s.list({type:'person',person_scope:'members',query:'账号新昵称'})).archives[0].id,a.id);
 assert.equal((await s.list({type:'person',query:'原昵称'})).archives[0].id,a.id);
 await assert.rejects(s.update(profile(a)),{code:'VERSION_CONFLICT'});
 const events=await s.events({id:a.id});const e=events.events.find(e=>e.kind==='archive.profile_changed');assert.ok(e);assert.equal(e.actor_id,f.actor.id);
 assert.throws(()=>f.sqlite.prepare('UPDATE archives SET name=? WHERE id=?').run('绕过账号',a.id));
 assert.equal((await s.update(profile(next))).changed,false);
});
test('existing profile can be explicitly linked by admin; unlinked edits and frozen identities remain usable',async t=>{
 const f=fixture();t.after(f.close);admin(f);const s=new Archives(f.env,f.actor,'web');
 const created=await s.create(create(f,{linked_account_id:null}));let a=await s.get(created.id);
 assert.equal((await s.update({...profile(a),name:'自由名称'})).changed,true);a=await s.get(a.id);
 f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.actor.id);
 // Keep the acting account separate from the frozen subject.
 const subject=uuid();f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,qq,created_at,frozen) VALUES(?,?,?,'member','fixture',0,'11111',?,1)").run(subject,subject,'冻结真人',new Date().toISOString());
 f.sqlite.prepare('UPDATE members SET frozen=0 WHERE id=?').run(f.actor.id);
 await s.update({...profile(a),linked_account_id:subject});a=await s.get(a.id);assert.equal(a.name,'冻结真人');assert.equal(a.linked_account_id,subject);assert.deepEqual(a.members,[]);
 await s.update({...profile(a),linked_account_id:null,name:'解除后的名称'});assert.equal((await s.get(a.id)).linked_account_id,null);
});
