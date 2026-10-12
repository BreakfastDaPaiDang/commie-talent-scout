import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Tags} from '../app/server/tags.ts';
import {Archives} from '../app/server/archives.ts';
import {registerArchiveTools} from '../app/server/mcp-archives.ts';
const DAY=86400000,NOW=Date.parse('2026-10-20T12:00:00.000Z');
function setup(t){t.mock.timers.enable({apis:['Date'],now:NOW});const f=fixture();t.after(f.close);return {...f,s:new Archives(f.env,f.actor,'web')};}
async function add(f,type,age,member=false){
 const a=await f.s.create({type,name:`虚构关闭筛选 ${type} ${age}`,status:member?'已入伙':'个人接触',request_id:uuid()});
 if(age!==null){await f.s.setState({id:a.id,expected_version:a.version,status:'已弃用',...(member?{membership_action:'leave'}:{}),member_ids:[],request_id:uuid()});if(member)f.sqlite.prepare("UPDATE archives SET status='已入伙',person_role=NULL,member_status=NULL WHERE id=?").run(a.id);f.sqlite.prepare("UPDATE archive_events SET created_at=? WHERE archive_id=? AND kind='archive.closed'").run(new Date(NOW-age*DAY).toISOString(),a.id);}
 // Deliberately decouple activity time from closing evidence.
 f.sqlite.prepare('UPDATE archives SET updated_at=? WHERE id=?').run(new Date(NOW-(age===null?200:0)*DAY).toISOString(),a.id);return a.id;
}
test('30/90/all filters only closures before counts and pagination in all three archive scopes',async t=>{
 const f=setup(t);
 for(const [type,member] of [['person',false],['person',true],['org',false]]){
  const ids=[];for(const age of [null,10,45,100])ids.push(await add(f,type,age,member));
  const input={type,...(type==='person'?{person_scope:member?'members':'external'}:{})};
  for(const [range,expected] of [['30',ids.slice(0,2)],['90',ids.slice(0,3)],['all',ids]]){
   const first=await f.s.list({...input,closed_history:range,limit:1});assert.equal(first.counts.all,expected.length);let found=first.archives.map(a=>a.id),cursor=first.next_cursor;
   while(cursor){const r=await f.s.list({...input,closed_history:range,limit:1,before:cursor});found.push(...r.archives.map(a=>a.id));cursor=r.next_cursor;}
   assert.deepEqual(found.sort(),[...expected].sort());
  }
  assert.equal((await f.s.list(input)).counts.all,4,'legacy API remains unbounded');
  assert.equal((await f.s.list({...input,closed_history:'30',closed:'closed'})).counts.all,1);
  assert.equal((await f.s.list({...input,closed_history:'30',closed:'open'})).counts.all,1);
  assert.equal((await f.s.list({...input,closed_history:'30',query:'100'})).counts.all,0);
  assert.equal((await f.s.detail(ids[3])).archive.id,ids[3],'old direct links still read hidden list items');
 }
});
test('last closing event, unknown dates, reopen and cursor time govern the range',async t=>{
 const f=setup(t),old=await add(f,'person',100),unknown=await add(f,'person',10),edge=await add(f,'person',30);
 f.sqlite.prepare("DELETE FROM archive_events WHERE archive_id=? AND kind='archive.closed'").run(unknown);
 assert.deepEqual((await f.s.list({type:'person',closed_history:'30'})).archives.map(a=>a.id),[edge]);
 const reopened=await f.s.reopen({id:old,expected_version:2,status:'个人接触',member_ids:[],request_id:uuid()});
 assert.ok((await f.s.list({type:'person',closed_history:'30'})).archives.some(a=>a.id===old));
 await f.s.setState({id:old,expected_version:reopened.version,status:'已弃用',member_ids:[],request_id:uuid()});
 const first=await f.s.list({type:'person',closed_history:'30',limit:1});assert.equal(first.counts.all,2);
 t.mock.timers.tick(DAY);const next=await f.s.list({type:'person',closed_history:'30',limit:1,before:first.next_cursor});assert.equal(next.archives.length,1,'continuation keeps the first page boundary');
 assert.equal((await f.s.list({type:'person',closed_history:'30'})).counts.all,1,'fresh query advances the rolling range');
 assert.equal((await f.s.list({type:'person',closed_history:'all'})).counts.all,3);
});
test('MCP uses identical explicit range and preserves absent-parameter compatibility',async t=>{
 const f=setup(t);await add(f,'org',null);await add(f,'org',100);const tools=new Map();
 registerArchiveTools({registerTool(name,config,run){tools.set(name,run);}},f.env,f.actor,async fn=>fn());
 const args={type:'org',closed_history:'30'};assert.deepEqual(await tools.get('list_archives')(args),await f.s.list(args));
 assert.equal((await tools.get('list_archives')({type:'org'})).counts.all,2);
});


test('history composes with search, bindings, status, tags, unread and deletion visibility',async t=>{
 const f=setup(t),tags=new Tags(f.env,f.actor,'web'),tag=f.sqlite.prepare("SELECT id FROM tags WHERE name='视频剪辑'").get().id,writer=uuid(),ids=[];
 f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,?)").run(writer,'writer','虚构作者',new Date(NOW).toISOString());
 for(const age of [10,10,100]){
  const a=await f.s.create({type:'person',name:'虚构组合历史',status:'个人接触',member_ids:[f.actor.id],request_id:uuid()});
  await tags.batch({archive_id:a.id,expected_version:1,changes:[{tag_id:tag,action:'add'}],request_id:uuid()});
  await f.s.setState({id:a.id,expected_version:2,status:'已弃用',member_ids:[f.actor.id],request_id:uuid()});
  f.sqlite.prepare("UPDATE archive_events SET created_at=? WHERE archive_id=? AND kind='archive.closed'").run(new Date(NOW-age*DAY).toISOString(),a.id);
  f.sqlite.prepare('UPDATE archive_events SET actor_id=? WHERE archive_id=?').run(writer,a.id);ids.push(a.id);
 }
 const filter={type:'person',query:'组合历史',status:'已弃用',member_id:f.actor.id,tag_ids:[tag],closed:'closed',closed_history:'30',limit:1};
 for(const scope of ['all','mine','unread']){
  const first=await f.s.list({...filter,scope});assert.deepEqual(first.counts,{all:2,mine:2,unread:2});assert.equal(first.archives.length,1);
  const second=await f.s.list({...filter,scope,before:first.next_cursor});assert.deepEqual([first.archives[0].id,second.archives[0].id].sort(),ids.slice(0,2).sort());assert.equal(second.next_cursor,null);
 }
 f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);
 const admin=new Archives(f.env,{...f.actor,role:'admin'},'web');await admin.setDeleted({id:ids[0],expected_version:3,request_id:uuid()},true);
 assert.equal((await f.s.list(filter)).counts.all,1);await assert.rejects(f.s.detail(ids[0]),e=>e.code==='NOT_FOUND');
 assert.equal((await admin.list({...filter,deleted:true})).counts.all,1);
});
