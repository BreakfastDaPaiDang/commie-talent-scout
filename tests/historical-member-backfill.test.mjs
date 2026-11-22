import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {backfillMember} from '../app/server/historical-member-backfill.ts';
import {generateScheduledMemberMonthlyFollowUps as generate} from '../app/server/member-monthly-follow-ups.ts';

const fields = {name:'历史成员甲',qq:'123456789',basis:'原工作组确认其已入社。',member_status:'暂不接工作'};
test('ordinary accounts backfill once across MCP and web; membership and observation commit together',async t=>{
  const f=fixture(); t.after(f.close);
  const args={...fields,request_id:uuid()};
  const [result,retry]=await Promise.all(['mcp','web'].map(source=>backfillMember(f.env,f.actor,source,args)));
  assert.equal(result.id,retry.id);
  assert.equal(result.observation_id,retry.observation_id);
  const archive=await new Archives(f.env,f.actor,'web').get(result.id);
  assert.equal(archive.person_role,'member'); assert.equal(archive.member_status,'暂不接工作');
  assert.equal(archive.linked_account_id,null);
  const observation=f.sqlite.prepare('SELECT o.author_id,v.body FROM observations o JOIN observation_versions v ON v.observation_id=o.id WHERE o.id=?').get(result.observation_id);
  assert.equal(observation.body,fields.basis); assert.equal(observation.author_id,f.actor.id);
  assert.equal((await generate(f.env,archive.created_at)).created_count,0);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM work_tasks').get().n,0);
  const repeated=await backfillMember(f.env,f.actor,'web',{...args,request_id:uuid()});
  assert.equal(repeated.changed,false);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM observations').get().n,1);
  assert.throws(()=>f.sqlite.prepare("UPDATE archives SET status='人事审核' WHERE id=?").run(archive.id));
});
test('existing exact QQ/person keeps its archive; mismatched or closed records cannot be silently converted',async t=>{
  const f=fixture(); t.after(f.close);
  const archives=new Archives(f.env,f.actor,'web');
  const ext=await archives.create({type:'person',name:fields.name,contacts:[{type:'qq',value:fields.qq}],request_id:uuid()});
  const run=(extra={})=>backfillMember(f.env,f.actor,'mcp',{...fields,...extra,request_id:uuid()});
  await assert.rejects(run({name:'另一个人'}),{code:'BACKFILL_QQ_CONFLICT'});
  f.sqlite.prepare("UPDATE archives SET closed=1 WHERE id=?").run(ext.id);
  await assert.rejects(run(),{code:'BACKFILL_QQ_CONFLICT'});
  f.sqlite.prepare("UPDATE archives SET closed=0 WHERE id=?").run(ext.id);
  assert.throws(()=>f.sqlite.prepare("UPDATE archives SET status='已入伙',person_role='member' WHERE id=?").run(ext.id));
  const results=await Promise.allSettled([run(),run()]);
  assert.ok(results.some(r=>r.status==='fulfilled' && r.value.id===ext.id && r.value.changed));
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM archives').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM observations').get().n,1);
  assert.equal((await archives.get(ext.id)).person_role,'member');
  await archives.setState({id:ext.id,expected_version:(await archives.get(ext.id)).version,status:'外部社友',member_ids:[],membership_action:'to_friend',request_id:uuid()});
  await assert.rejects(run(),{code:'BACKFILL_NOT_APPLICABLE'});
  assert.throws(()=>f.sqlite.prepare("UPDATE archives SET status='已入伙',person_role='member',version=version+1 WHERE id=?").run(ext.id));
});
test('failed observation or frozen actor leaves no partial backfill',async t=>{
  const f=fixture();t.after(f.close);
  const run=()=>backfillMember(f.env,f.actor,'mcp',{...fields,request_id:uuid()});
  f.sqlite.exec("CREATE TRIGGER simulated_failure BEFORE INSERT ON observation_versions BEGIN SELECT RAISE(ABORT,'simulated failure'); END");
  await assert.rejects(run());
  f.sqlite.exec('DROP TRIGGER simulated_failure');
  f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.actor.id);
  await assert.rejects(run());
  for(const tbl of ['archives','observations','personnel_member_backfills'])
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM '+tbl).get().n,0);
});
