import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Members} from '../app/server/members.ts';

test('members start with no recommendation preference and can save only their own versioned inclination',async t=>{
 const f=fixture();t.after(f.close);const web=new Members(f.env,f.actor,'web'),mcp=new Members(f.env,f.actor,'mcp');
 assert.deepEqual((await web.getOwnWorkPreference()).preference,{all:false,kinds:[],version:0,updated_at:null});
 const input={all:false,kinds:['monthly','audit','audit'],expected_version:0,request_id:uuid()};
 const saved=await web.setOwnWorkPreference(input);assert.deepEqual(saved,{all:false,kinds:['audit','monthly'],version:1,updated_at:saved.updated_at,changed:true});
 assert.equal((await mcp.getOwnWorkPreference()).preference.version,1);assert.deepEqual((await mcp.getOwnWorkPreference()).preference.kinds,['audit','monthly']);
 assert.equal((await web.setOwnWorkPreference(input)).replayed,true);
 await assert.rejects(web.setOwnWorkPreference({all:true,kinds:[],expected_version:0,request_id:uuid()}),{code:'VERSION_CONFLICT'});
 const all=await mcp.setOwnWorkPreference({all:true,kinds:[],expected_version:1,request_id:uuid()});assert.equal(all.all,true);assert.equal(all.version,2);
 const history=f.sqlite.prepare("SELECT kind,before_json,after_json FROM member_events WHERE member_id=? AND kind='member.work_preference_changed'").all(f.actor.id);assert.equal(history.length,2);assert.equal(JSON.parse(history[0].after_json).all,true);
});

test('unchanged preference saves are idempotent and do not create another version or event',async t=>{
 const f=fixture();t.after(f.close);const service=new Members(f.env,f.actor,'web'),first=await service.setOwnWorkPreference({all:true,kinds:[],expected_version:0,request_id:uuid()}),events=()=>f.sqlite.prepare("SELECT count(*) n FROM member_events WHERE kind='member.work_preference_changed'").get().n;
 assert.equal(events(),1);const second=await service.setOwnWorkPreference({all:true,kinds:[],expected_version:first.version,request_id:uuid()});assert.equal(second.changed,false);assert.equal(second.version,first.version);assert.equal(events(),1);
});
