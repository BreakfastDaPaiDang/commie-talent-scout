import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';

const request=(a,status,member_ids=[])=>({id:a.id,expected_version:a.version,status,member_ids,request_id:uuid()});
const history=f=>f.sqlite.prepare('SELECT kind,source,before_json,after_json FROM archive_events ORDER BY seq').all();
function member(f){const id=uuid();f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,'2026-01-01')").run(id,id,'虚构关联成员');return id;}

test('web and MCP share close/reopen behavior, request replay and unchanged-save semantics',async t=>{
 const f=fixture();t.after(f.close);const web=new Archives(f.env,f.actor,'web'),mcp=new Archives(f.env,f.actor,'mcp');
 const a=await web.create({type:'person',name:'虚构生命周期',request_id:uuid()});
 const first=request(a,'人事审核',[f.actor.id]);const working=await web.setState(first);
 const count=history(f).length;assert.equal((await mcp.setState(first)).replayed,true);assert.equal(history(f).length,count);
 const before=await web.get(a.id);assert.equal((await mcp.setState(request(before,'人事审核',[f.actor.id]))).changed,false);
 assert.equal((await web.get(a.id)).updated_at,before.updated_at);assert.equal(history(f).length,count);
 const closing=request(working,'已入伙',[f.actor.id]),closed=await mcp.setState(closing);
 assert.equal(closed.closed,true,'S01 must preserve the OLD 已入伙 closing rule');
 assert.equal((await web.get(a.id)).last_open_status,'人事审核');assert.equal((await web.get(a.id)).tag_snapshot_version,closed.version);
 assert.equal((await web.setState(closing)).replayed,true);
 await assert.rejects(web.setState(request(closed,'视奸观察')),{code:'ARCHIVE_CLOSED'});
 await assert.rejects(new Observations(f.env,f.actor,'web').create({archive_id:a.id,body:'不能写入',request_id:uuid()}),{code:'ARCHIVE_CLOSED'});
 await assert.rejects(web.reopen(request(closed,'已弃用')),{code:'INVALID_REOPEN'});
 const reopening=request(closed,'个人接触'),opened=await web.reopen(reopening);assert.equal(opened.closed,false);
 assert.equal((await mcp.reopen(reopening)).replayed,true);
 await assert.rejects(mcp.reopen(request(opened,'视奸观察')),{code:'INVALID_REOPEN'});
 assert.deepEqual(history(f).map(e=>[e.kind,e.source]),[['archive.created','web'],['archive.state_changed','web'],['archive.state_changed','mcp'],['archive.closed','mcp'],['archive.state_changed','web'],['archive.reopened','web']]);
});

test('invalid states, required responsibility and retained frozen associations preserve baseline behavior',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),id=member(f);
 const a=await s.create({type:'person',name:'虚构冻结归属',request_id:uuid()});
 await assert.rejects(s.setState(request(a,'组织交流')),{code:'INVALID_STATE'});
 await assert.rejects(s.setState(request(a,'人事审核')),{code:'RESPONSIBLE_REQUIRED'});
 const working=await s.setState(request(a,'人事审核',[id]));
 f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(id);
 assert.equal((await s.setState(request(working,'人事审核',[id]))).changed,false);
 await assert.rejects(s.setState(request(working,'已加入待对接',[id])),{code:'MEMBER_FROZEN'});
 const closed=await s.setState(request(working,'已弃用',[id]));assert.equal(closed.closed,true);
 assert.equal((await s.reopen(request(closed,'人事审核',[id]))).closed,false,'existing target-state association can be retained');
});

test('concurrent archive edits, authority revocation, member freeze and SQL failure cannot partially close an archive',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),id=member(f),a=await s.create({type:'person',name:'虚构事务边界',request_id:uuid()});
 const realBatch=f.env.DB.batch;let beforeCommit;
 f.env.DB.batch=async statements=>{if(beforeCommit){const action=beforeCommit;beforeCommit=null;await action();}return realBatch(statements);};
 beforeCommit=()=>s.update({id:a.id,expected_version:1,name:'已被并发修改',contacts:[],links:[],request_id:uuid()});
 await assert.rejects(s.setState(request(a,'已弃用')),{code:'PRECONDITION_CHANGED'});
 const current=await s.get(a.id);assert.equal(current.closed,false);
 await assert.rejects(s.setState(request(a,'已弃用')),{code:'VERSION_CONFLICT'});
 beforeCommit=()=>f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(id);
 await assert.rejects(s.setState(request(current,'已弃用',[id])),{code:'PRECONDITION_CHANGED'});
 beforeCommit=()=>f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.actor.id);
 await assert.rejects(s.setState(request(current,'已弃用')),{code:'PRECONDITION_CHANGED'});
 f.sqlite.prepare('UPDATE members SET frozen=0 WHERE id=?').run(f.actor.id);
 const before=history(f),input=request(current,'已弃用');
 f.sqlite.exec("CREATE TRIGGER reject_close BEFORE INSERT ON archive_events WHEN NEW.kind='archive.closed' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
 await assert.rejects(s.setState(input),/injected failure/);
 assert.deepEqual(history(f),before);assert.equal((await s.get(a.id)).version,current.version);assert.equal((await s.get(a.id)).closed,false);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM commands WHERE request_id=?').get(input.request_id).n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mutation_guards').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM archive_tag_snapshots WHERE archive_id=?').get(a.id).n,0);
 f.sqlite.exec('DROP TRIGGER reject_close');assert.equal((await s.setState(input)).closed,true,'the same request can succeed after rollback');
});
