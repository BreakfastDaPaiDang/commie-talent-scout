import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Tags} from '../app/server/tags.ts';
import {Observations} from '../app/server/observations.ts';

test('tag OR within category and AND across categories precedes pagination and combines with archive filters',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),tags=new Tags(f.env,f.actor,'web');
 const tag=name=>f.sqlite.prepare('SELECT id FROM tags WHERE name=?').get(name).id;
 const english=tag('英语'),japanese=tag('日语'),video=tag('视频剪辑'),ids=[];
 for(const [name,bindings] of [['甲',[english,video]],['乙',[japanese,video]],['丙',[english]],['丁',[video]]]){const a=await s.create({type:'person',name:'虚构组合 '+name,request_id:uuid()});ids.push(a.id);await tags.batch({archive_id:a.id,expected_version:1,changes:bindings.map(tag_id=>({tag_id,action:'add'})),request_id:uuid()});}
 const filter={type:'person',tag_ids:[english,japanese,video],query:'虚构组合',closed:'open',limit:1};
 const first=await s.list(filter);assert.equal(first.counts.all,2);assert.equal(first.archives.length,1);assert.ok(first.next_cursor);
 const second=await s.list({...filter,before:first.next_cursor});assert.equal(second.archives.length,1);assert.equal(second.next_cursor,null);assert.deepEqual([first.archives[0].id,second.archives[0].id].sort(),ids.slice(0,2).sort());
 assert.equal((await s.list({...filter,tag_ids:[japanese],query:'甲'})).counts.all,0);
 assert.equal((await s.list({...filter,status:'人事审核'})).counts.all,0);
 await assert.rejects(s.list({...filter,tag_ids:[uuid()]}),e=>e.code==='TAG_NOT_FOUND');
 assert.equal((await s.list({...filter,tag_ids:[english,english]})).counts.all,2);
});

test('hidden source cannot match tag filter or count even in closed snapshots; independent evidence and restoration remain visible',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),tags=new Tags(f.env,f.actor,'web'),obs=new Observations(f.env,f.actor,'web');
 const tag=f.sqlite.prepare("SELECT id FROM tags WHERE name='视频剪辑'").get().id,a=await s.create({type:'person',name:'虚构来源',request_id:uuid()}),o=await obs.create({archive_id:a.id,body:'虚构受限正文',request_id:uuid()});
 await tags.batch({archive_id:a.id,expected_version:2,changes:[{tag_id:tag,action:'add',evidence:[{kind:'observation',note:'受限说明',observation_id:o.id,content_version:1}]}],request_id:uuid()});
 const reader=new Archives(f.env,{...f.actor,id:uuid()},'web'),query={type:'person',tag_ids:[tag]};assert.equal((await reader.list(query)).counts.all,1);
 await obs.setDeleted({id:o.id,expected_version:1,request_id:uuid()},true);assert.equal((await reader.list(query)).counts.all,0);assert.equal((await s.list(query)).counts.all,1);
 let current=await s.get(a.id);await s.setState({id:a.id,expected_version:current.version,status:'已弃用',member_ids:[],request_id:uuid()});assert.equal((await reader.list(query)).counts.all,0);assert.equal((await s.list({...query,closed:'closed'})).counts.all,1);
 current=await s.get(a.id);await s.reopen({id:a.id,expected_version:current.version,status:'视奸观察',member_ids:[],request_id:uuid()});
 await obs.setDeleted({id:o.id,expected_version:2,request_id:uuid()},false);assert.equal((await reader.list(query)).counts.all,1);
 current=await s.get(a.id);await tags.batch({archive_id:a.id,expected_version:current.version,changes:[{tag_id:tag,action:'evidence',evidence:[{kind:'observation',note:'受限说明',observation_id:o.id,content_version:1},{kind:'member_instruction',note:'另一条独立授权依据'}]}],request_id:uuid()});
 await obs.setDeleted({id:o.id,expected_version:3,request_id:uuid()},true);assert.equal((await reader.list(query)).counts.all,1);const result=await reader.list(query);assert.ok(!JSON.stringify(result).includes('受限说明'));assert.equal(result.archives[0].tag_summary.total,1);
});
