import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {personnelMap} from '../app/server/personnel-map.ts';
import {rankForPerson,rankForStatus} from '../app/shared/personnel-ranks.ts';
import {makeResource,allocation,seedLegacy} from './internal-resource-fixture.mjs';
const rank=(map,id)=>map.layers.find(l=>l.id===id);
test('default ranks collapse pre-review activities without inventing advancement and preserve review/member/friend identities',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),r=await makeResource(f);for(const status of ['视奸观察','个人接触','人事审核','已加入待对接','已入伙','外部社友'])await s.create({type:'person',name:status,status,resources:[allocation(r)],request_id:uuid()});const map=await personnelMap(f.env,f.actor,{});
 assert.deepEqual(map.layers.map(l=>l.id),['pending','review','approved','member','friend']);assert.equal(rank(map,'pending').people,2);assert.equal(rank(map,'pending').cells.filter(c=>c.resource_id===r.id).length,1);assert.equal(rank(map,'pending').cells.find(c=>c.resource_id===r.id).people.length,2);assert.equal(rank(map,'review').people,1);assert.equal(rank(map,'approved').people,1);assert.equal(rank(map,'member').people,1);assert.equal(rank(map,'friend').people,1);assert.equal(map.links.length,0);assert.equal(rankForStatus('引荐中（待人事组接触）'),'pending');assert.equal(rankForPerson({type:'org',status:'组织交流',person_role:null}),null);
});
test('state changes within pending do not become rank transfers; real cross-rank changes deduplicate merged resource paths',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),r=await makeResource(f),p=await s.create({type:'person',name:'候审',resources:[allocation(r)],request_id:uuid()});await s.setState({id:p.id,expected_version:1,status:'个人接触',member_ids:[],request_id:uuid()});let map=await personnelMap(f.env,f.actor,{});assert.equal(map.links.filter(e=>e.kind==='transfer').length,0);await s.setState({id:p.id,expected_version:2,status:'人事审核',member_ids:[],request_id:uuid()});map=await personnelMap(f.env,f.actor,{});assert.equal(map.links.filter(e=>e.kind==='transfer').length,1);const e=map.links.find(e=>e.kind==='transfer');assert.ok(e.from.startsWith('pending|'));assert.ok(e.to.startsWith('review|'));assert.deepEqual(e.people,[p.id]);assert.equal(map.movements.length,2,'granular historical facts remain readable');
});
test('external organizations keep relationship states and separate counts; recorded contacts are relationships, not personnel flows or owned assets',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),org=await s.create({type:'org',name:'组织甲',status:'组织交流',member_ids:[f.actor.id],request_id:uuid()}),watched=await s.create({type:'org',name:'组织乙',request_id:uuid()}),p=await s.create({type:'person',name:'联系人员',status:'外部社友',request_id:uuid()});seedLegacy(f,p.id,[{id:uuid(),name:'已知外部联系',type:'群聊',note:'既有关系',archive_id:org.id,usage:'active'}]);
 let map=await personnelMap(f.env,f.actor,{}),friend=rank(map,'friend');assert.equal(map.archives.length,1);assert.equal(friend.people,1);assert.equal(friend.organizations,2);assert.equal(map.organizations.find(o=>o.id===watched.id).status,'视奸观察');assert.equal(friend.resources,0);assert.equal(friend.cells.find(c=>c.organization_ids).people.length,0);assert.equal(friend.cells.find(c=>c.organization_ids).organization_ids.length,2);assert.ok(map.links.some(e=>e.kind==='organization_contact'));assert.equal(map.links.filter(e=>e.kind==='transfer'||e.kind==='resource_transfer').length,0);
 map=await personnelMap(f.env,f.actor,{query:'联系人员'});assert.equal(map.organizations.length,1,'a filtered person retains their visible recorded organization context');f.sqlite.prepare('UPDATE archives SET deleted=1 WHERE id=?').run(org.id);map=await personnelMap(f.env,f.actor,{});assert.equal(map.organizations.length,1);assert.ok(!map.links.some(e=>e.kind==='organization_contact'));assert.ok(!JSON.stringify(map).includes('组织甲'));
 await s.setState({id:watched.id,expected_version:1,status:'已弃用',member_ids:[],request_id:uuid()});map=await personnelMap(f.env,f.actor,{});assert.equal(map.organizations.length,0);
});
