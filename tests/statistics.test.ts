import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {statistics,statisticsInput} from '../app/server/statistics.ts';
import {bucketDate,shanghaiDate} from '../app/shared/statistics.ts';
import type {Actor,Env} from '../app/server/types.ts';

function fixture() {
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+file,'utf8'));
  const run=(sql:string,...args:(string|number|null)[])=>db.prepare(sql).run(...args);
  const at='2026-09-01T00:00:00.000Z';
  for(const id of ['u1','u2'])run('INSERT INTO members(id,username,name,role,password_hash,created_at) VALUES(?,?,?,?,?,?)',id,id,'同名成员','member','unused',at);
  for(const [id,type] of [['a1','person'],['a2','org'],['a3','person']])run('INSERT INTO archives(id,type,name,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)',id,type,id,'u1',at,at);
  for(const [id,archive,author,time] of [['o1','a1','u1','2026-09-01T15:59:59.000Z'],['o2','a1','u2','2026-09-01T16:00:00.000Z'],['o3','a2','u1','2026-09-02T16:00:00.000Z'],['deleted','a1','u1',at],['hidden','a3','u1',at]])run('INSERT INTO observations(id,archive_id,author_id,created_at,updated_at) VALUES(?,?,?,?,?)',id,archive,author,time,time);
  run("UPDATE observations SET deleted=1 WHERE id='deleted'");run("UPDATE archives SET deleted=1 WHERE id='a3'");
  run('INSERT INTO tag_categories(id,type,name,name_key,created_at,updated_at) VALUES(?,?,?,?,?,?)','cat','person','技能','test',at,at);
  for(const id of ['t1','t2','secret'])run('INSERT INTO tags(id,category_id,name,name_key,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',id,'cat',id,id,'test',at,at);
  for(const id of ['t1','t2'])run('INSERT INTO archive_tags(archive_id,tag_id,added_by,added_at,confirmed_by,confirmed_at) VALUES(?,?,?,?,?,?)','a1',id,'u1',at,'u1',at);
  run('INSERT INTO archive_tags(archive_id,tag_id,added_by,added_at,confirmed_by,confirmed_at,evidence_json) VALUES(?,?,?,?,?,?,?)','a1','secret','u1',at,'u1',at,JSON.stringify([{kind:'observation',observation_id:'deleted',content_version:1,note:'hidden'}]));
  const env={DB:{prepare(sql:string){return {bind(...args:(string|number|null)[]){return {async first(){return db.prepare(sql).get(...args)??null;}};}};}}} as Env;
  const actor={id:'u2',role:'member'} as Actor;
  const query={from:'2026-09-01',to:'2026-09-04'};
  return {db,run,env,actor,query};
}

test('statistics counts identities, fills zero days and uses Shanghai submission dates',async()=>{
  const {db,env,actor,query}=fixture();try{
    const result=await statistics(env,actor,query);
    assert.equal(result.total,3);assert.equal(result.members,2);assert.equal(result.archives,2);
    assert.deepEqual(result.series.find(s=>s.id==='u1')?.points,[1,0,1,0]);
    assert.deepEqual(result.series.find(s=>s.id==='u2')?.points,[0,1,0,0]);
    assert.notEqual(result.series[0].name,result.series[1].name);
    const day=await statistics(env,actor,{...query,from:'2026-09-02',to:'2026-09-02'});
    assert.equal(day.total,1);
  }finally{db.close();}
});
test('tags overlap but category and overall counts deduplicate; hidden evidence never leaks',async()=>{
  const {db,env,actor,query}=fixture();try{
    const tags=await statistics(env,actor,{...query,group:'tag'});
    assert.equal(tags.total,3);assert.equal(tags.series.find(s=>s.id==='t1')?.total,2);
    assert.equal(tags.series.find(s=>s.id==='t2')?.total,2);
    assert.ok(!tags.series.some(s=>s.id==='secret'));
    assert.equal(tags.series.find(s=>s.id==='untagged')?.total,1);
    const categories=await statistics(env,actor,{...query,group:'category'});
    assert.equal(categories.series.find(s=>s.id==='cat')?.total,2);
    const owner=await statistics(env,{...actor,id:'u1'},{...query,group:'tag'});
    assert.equal(owner.series.find(s=>s.id==='secret')?.total,2);
  }finally{db.close();}
});
test('filters, empty results, week/month boundaries and literal search',async()=>{
  const {db,env,actor,query}=fixture();try{
    assert.equal((await statistics(env,actor,{...query,archive_type:'org'})).total,1);
    assert.equal((await statistics(env,actor,{...query,group:'tag',search:'t1'})).total,2);
    assert.equal((await statistics(env,actor,{...query,search:'%'})).total,0);
    assert.deepEqual((await statistics(env,actor,{...query,interval:'week'})).dates,['2026-08-31']);
    assert.deepEqual((await statistics(env,actor,{...query,interval:'month'})).dates,['2026-09-01']);
    assert.equal(bucketDate('2026-01-01','week'),'2025-12-29');
    assert.equal(shanghaiDate(new Date('2026-09-01T16:00:00Z')),'2026-09-02');
    assert.throws(()=>statisticsInput.parse({...query,from:'2026-02-30'}));
    assert.throws(()=>statisticsInput.parse({...query,to:'2026-08-31'}));
    assert.throws(()=>statisticsInput.parse({...query,to:'2027-10-01'}));
  }finally{db.close();}
});
test('closed archives use snapshots; deleted catalog entries are excluded',async()=>{
  const {db,run,env,actor,query}=fixture();try{
    run("INSERT INTO archive_tag_snapshots SELECT archive_id,1,tag_id,json_object('tag_id',tag_id,'category_id','cat','category_name','旧类别','name','旧名称','evidence',json('[]')) FROM archive_tags WHERE tag_id='t1'");
    run("UPDATE archives SET closed=1,tag_snapshot_version=1 WHERE id='a1'");
    const closed=await statistics(env,actor,{...query,group:'tag'});
    assert.equal(closed.series.find(s=>s.id==='t1')?.name,'旧类别：旧名称');
    assert.ok(!closed.series.some(s=>s.id==='t2'));
    run("UPDATE tags SET deleted=1 WHERE id='t1'");
    assert.ok(!(await statistics(env,actor,{...query,group:'tag'})).series.some(s=>s.id==='t1'));
  }finally{db.close();}
});
