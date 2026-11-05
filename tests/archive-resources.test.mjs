import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
const entry=(archive_id=null)=>({id:uuid(),name:'实际资源名称',type:'工作组',note:'已有联系，提供实际工作',archive_id,usage:'active'});
const edit=(a,resources)=>({id:a.id,expected_version:a.version,name:a.name,contacts:a.contacts,links:a.links,...(resources===undefined?{}:{resources}),request_id:uuid()});

test('resources reuse archive commands, stable IDs, history, no-change and legacy omitted-field behavior',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),target=await s.create({type:'org',name:'真实关联组织',request_id:uuid()}),resource=entry(target.id);
 const input={type:'person',name:'虚构人员',resources:[resource],request_id:uuid()},created=await s.create(input);assert.equal((await s.create(input)).replayed,true);
 let a=await s.get(created.id);assert.equal(a.resources[0].linked_archive.name,'真实关联组织');assert.equal(a.resources[0].usage,'active');assert.equal(a.status,'视奸观察');assert.equal(a.person_role,'external');
 const events=f.sqlite.prepare('SELECT count(*) n FROM archive_events WHERE archive_id=?').get(a.id).n;
 assert.equal((await s.update(edit(a))).changed,false);assert.equal((await s.get(a.id)).version,1);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM archive_events WHERE archive_id=?').get(a.id).n,events);
 assert.equal((await s.list({type:'person'})).archives.find(x=>x.id===a.id).resources[0].linked_archive.id,target.id);
 const change=edit(a,[{...resource,note:'明确计划，尚未实际使用',usage:'planned'}]);assert.equal((await s.update(change)).version,2);assert.equal((await s.update(change)).replayed,true);
 const history=await s.events({id:a.id});assert.equal(history.events[0].before.resources[0].usage,'active');assert.equal(history.events[0].after.resources[0].usage,'planned');
 await assert.rejects(s.update(edit(a,[])),{code:'VERSION_CONFLICT'});a=await s.get(a.id);await s.update(edit(a,[]));assert.deepEqual((await s.get(a.id)).resources,[]);
});

test('hidden linked archives stay hidden in fields, lists, timeline and events; opaque retention is lossless',async t=>{
 const f=fixture();t.after(f.close);f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';const s=new Archives(f.env,f.actor,'web');
 const target=await s.create({type:'org',name:'不应泄漏的关联名称',request_id:uuid()}),r={...entry(target.id),name:'不应泄漏的资源名称',note:'不应泄漏的说明'};
 const owner=await s.create({type:'person',name:'可见人员',resources:[r],request_id:uuid()});await s.setDeleted({id:target.id,expected_version:1,request_id:uuid()},true);
 const a=await s.get(owner.id);assert.deepEqual(a.resources,[{id:r.id,restricted:true}]);
 for(const data of [await s.list({type:'person'}),await s.events({id:a.id}),await new Observations(f.env,f.actor,'web').timeline({id:a.id})]){const serialized=JSON.stringify(data);assert.ok(!serialized.includes('不应泄漏'));assert.ok(!serialized.includes(target.id));}
 await s.update({...edit(a,a.resources),name:'只修改可见名称'});assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT resources_json FROM archives WHERE id=?').get(a.id).resources_json),[r]);
 await assert.rejects(s.create({type:'person',name:'新猜测',resources:[r],request_id:uuid()}),{code:'RESOURCE_ARCHIVE_UNAVAILABLE'});
 await assert.rejects(s.create({type:'person',name:'伪造保留',resources:[{id:uuid(),restricted:true}],request_id:uuid()}),{code:'INVALID_RESOURCE'});
});

test('target deletion racing resource save rolls back profile, history and receipt',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),target=await s.create({type:'org',name:'关联对象',request_id:uuid()}),created=await s.create({type:'person',name:'原始人员',request_id:uuid()}),a=await s.get(created.id),batch=f.env.DB.batch.bind(f.env.DB);let once=true;
 f.env.DB.batch=async statements=>{if(once){once=false;f.sqlite.prepare('UPDATE archives SET deleted=1,version=version+1 WHERE id=?').run(target.id);}return batch(statements);};
 const input={...edit(a,[entry(target.id)]),name:'不能部分保存'};await assert.rejects(s.update(input),{code:'PRECONDITION_CHANGED'});assert.equal((await s.get(a.id)).name,'原始人员');assert.deepEqual((await s.get(a.id)).resources,[]);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM commands WHERE request_id=?').get(input.request_id).n,0);
});

test('closed source locks resources and validates duplicate entry IDs and capacity of the field',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),r=entry();await assert.rejects(s.create({type:'person',name:'重复',resources:[r,r],request_id:uuid()}));
 const created=await s.create({type:'person',name:'关闭资源',resources:[r],request_id:uuid()});const closed=await s.setState({id:created.id,expected_version:1,status:'已弃用',member_ids:[],request_id:uuid()});
 await assert.rejects(s.update(edit({...await s.get(created.id),version:closed.version},[])),{code:'ARCHIVE_CLOSED'});assert.equal((await s.get(created.id)).resources[0].name,r.name);
});
