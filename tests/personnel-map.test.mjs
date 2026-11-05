import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {personnelMap} from '../app/server/personnel-map.ts';
const res=(name,archive_id,usage='active')=>({id:uuid(),name,type:'社群',archive_id,usage,note:'实际登记'});
const getCell=(map,stage,name)=>map.layers.find(l=>l.id===stage).cells.find(c=>c.title===name);
test('unlinked entries are scoped to their source archive, even when copied IDs and names match',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),r=res('同名未关联资源',null);
 await s.create({type:'person',name:'甲',resources:[r],request_id:uuid()});await s.create({type:'person',name:'乙',resources:[r],request_id:uuid()});
 const map=await personnelMap(f.env,f.actor,{}),layer=map.layers.find(l=>l.id==='视奸观察');assert.equal(layer.cells.length,2);assert.equal(layer.resources,2);assert.ok(layer.cells.every(c=>c.people.length===1));assert.equal(map.links.length,0);
});
test('layered containers reuse real archive names, deduplicate people and distinguish planned from actual',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),group=await s.create({type:'org',name:'现有组织甲',request_id:uuid()}),other=await s.create({type:'org',name:'现有组织乙',request_id:uuid()});
 const p=await s.create({type:'person',name:'虚构参与者',resources:[res('别称甲',group.id),res('别称乙',other.id),res('计划别称',group.id,'planned')],request_id:uuid()});
 await s.create({type:'person',name:'未填写归属',request_id:uuid()});
 const map=await personnelMap(f.env,f.actor,{}),layer=map.layers.find(l=>l.id==='视奸观察');assert.equal(layer.people,2);assert.equal(layer.unplaced,1);assert.equal(getCell(map,'视奸观察','现有组织甲').people.length,1);assert.equal(getCell(map,'视奸观察','现有组织甲').planned.length,1);assert.equal(map.links.filter(e=>e.kind==='shared').length,1);assert.deepEqual(map.links.find(e=>e.kind==='shared').people,[p.id]);assert.equal(map.links.filter(e=>e.kind==='transfer').length,0);assert.equal(map.complete,true);assert.equal(layer.resources,2);
 const searched=await personnelMap(f.env,f.actor,{query:'现有组织甲'});assert.equal(getCell(searched,'视奸观察','现有组织甲').people.length,1,'searching a container retains its recorded people');
});

test('recorded stage transfers use their historical resource snapshots and existing task bottlenecks',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),a=await s.create({type:'org',name:'旧社群',request_id:uuid()}),b=await s.create({type:'org',name:'后来项目',request_id:uuid()}),p=await s.create({type:'person',name:'人员',resources:[res('原记录',a.id)],request_id:uuid()});
 await s.setState({id:p.id,expected_version:1,status:'人事审核',member_ids:[f.actor.id],request_id:uuid()});
 const current=await s.get(p.id);await s.update({id:p.id,expected_version:current.version,name:current.name,contacts:current.contacts,links:current.links,resources:[res('新记录',b.id)],request_id:uuid()});
 const map=await personnelMap(f.env,f.actor,{}),link=map.links.find(e=>e.kind==='transfer'),cells=map.layers.flatMap(l=>l.cells);
 assert.equal(cells.find(c=>c.id===link.from).title,'旧社群');assert.equal(cells.find(c=>c.id===link.to).title,'旧社群');assert.equal(getCell(map,'人事审核','后来项目').people.length,1);assert.equal(map.archives.find(a=>a.id===p.id).unassigned_tasks,1);assert.equal(map.layers.find(l=>l.id==='人事审核').attention,1);assert.equal(map.layers.find(l=>l.id==='人事审核').people,1);
});

test('deleted resource targets, deleted/closed source archives and their private names never leak into graph',async t=>{
 const f=fixture();t.after(f.close);f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';const s=new Archives(f.env,f.actor,'web');
 const target=await s.create({type:'org',name:'不可见目标',request_id:uuid()}),p=await s.create({type:'person',name:'可见人员',resources:[res('不可见资源别称',target.id)],request_id:uuid()});
 await s.setState({id:p.id,expected_version:1,status:'个人接触',member_ids:[],request_id:uuid()});await s.setDeleted({id:target.id,expected_version:1,request_id:uuid()},true);
 const map=await personnelMap(f.env,f.actor,{}),serialized=JSON.stringify(map);assert.ok(!serialized.includes('不可见'));assert.ok(!serialized.includes(target.id));assert.equal(map.layers.find(l=>l.id==='个人接触').unplaced,1);
 assert.equal((await personnelMap(f.env,f.actor,{query:'不可见资源别称'})).archives.length,0,'search does not disclose hidden resource names');
 await s.setState({id:p.id,expected_version:2,status:'已弃用',member_ids:[],request_id:uuid()});const empty=await personnelMap(f.env,f.actor,{});assert.equal(empty.archives.length,0);assert.equal(empty.links.length,0);
});
