import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('archive-states'),checks=[];
try{
 const created=await v.call('create_archive',{type:'person',name:'虚构状态验收 '+randomUUID().slice(0,8),request_id:randomUUID()});
 const args={id:created.id,expected_version:1,status:'人事审核',member_ids:[],request_id:randomUUID()};
 const missing=await v.http('/archives/state',args);assert.equal(missing.status,400,'work status rejects a missing explicit responsible member');assert.equal(missing.body.error.code,'RESPONSIBLE_REQUIRED');
 const update=await v.call('set_archive_state',{...args,member_ids:[v.actor.id],request_id:randomUUID()});assert.equal(update.version,2);
 let a=(await v.call('get_archive',{id:created.id})).archive;assert.equal(a.status,'人事审核');assert.deepEqual(a.members.map(m=>m.id),[v.actor.id]);
 checks.push('work states require explicit responsibility, with no sequential workflow prerequisite');
 const switchState=await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'个人接触',member_ids:[],request_id:randomUUID()});
 a=(await v.call('get_archive',{id:a.id})).archive;assert.equal(a.members.length,0);assert.deepEqual(a.bindings['人事审核'].map(m=>m.id),[v.actor.id]);
 const nop=await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:a.status,member_ids:[],request_id:randomUUID()});assert.equal(nop.changed,false);assert.equal(nop.version,switchState.version);
 checks.push('only current-state members display, earlier bindings remain available in history, and no-op saves add no version');
 const race=await Promise.all([v.http('/archives/state',{id:a.id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:randomUUID()}),v.http('/archives/update',{id:a.id,expected_version:a.version,name:a.name+' 并发修改',contacts:[],links:[],request_id:randomUUID()})]);assert.equal(race.filter(r=>r.status===200).length,1);assert.equal(race.filter(r=>r.status===409).length,1);
 a=(await v.call('get_archive',{id:a.id})).archive;if(!a.closed){await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:randomUUID()});a=(await v.call('get_archive',{id:a.id})).archive;}
 const blocked=await v.http('/archives/update',{id:a.id,expected_version:a.version,name:'不允许',contacts:[],links:[],request_id:randomUUID()});assert.equal(blocked.status,409);assert.equal(blocked.body.error.code,'ARCHIVE_CLOSED');
 assert.equal((await v.http('/archives/state',{id:a.id,expected_version:a.version,status:'个人接触',member_ids:[],request_id:randomUUID()})).status,409);
 assert.equal((await v.http('/archives/reopen',{id:a.id,expected_version:a.version,status:'人事审核',member_ids:[],request_id:randomUUID()})).status,400);
 checks.push('close and profile races serialize, and even administrators cannot edit a closed archive or bypass explicit reopen');
 await v.call('reopen_archive',{id:a.id,expected_version:a.version,status:'人事审核',member_ids:[v.actor.id],request_id:randomUUID()});a=(await v.call('get_archive',{id:a.id})).archive;assert.equal(a.closed,false);assert.equal(a.status,'人事审核');
 const events=(await v.call('list_archive_events',{id:a.id})).events;assert.ok(events.some(e=>e.kind==='archive.closed'));assert.ok(events.some(e=>e.kind==='archive.reopened'));assert.ok(events.some(e=>e.kind==='archive.state_changed'));
 const org=await v.call('create_archive',{type:'org',name:'虚构组织状态验收',status:'组织交流',member_ids:[v.actor.id],request_id:randomUUID()});
 assert.equal((await v.http('/archives/state',{id:org.id,expected_version:1,status:'已入伙',member_ids:[],request_id:randomUUID()})).status,400);
 checks.push('reopen validates state and responsibility atomically; creation supports valid work states and type-specific state sets');
}finally{await v.close(checks);}
