import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('archives'),checks=[];
try{
 const input={type:'person',name:'虚构档案验收 '+randomUUID().slice(0,8),contacts:[{type:'QQ',value:'001234567',note:'虚构号码'}],links:[{label:'来源',url:'https://example.com/'}],request_id:randomUUID()};
 const created=await v.http('/archives/create',input);assert.equal(created.status,200,'member can create an archive');
 const id=created.body.id,replay=await v.call('create_archive',input);assert.equal(replay.id,id);assert.equal(replay.replayed,true);
 const detail=(await v.call('get_archive',{id})).archive;assert.equal(detail.contacts[0].value,'001234567');assert.equal(detail.type,'person');
 checks.push('web creation and MCP retry share one archive, preserving QQ as a string');
 const history=await v.call('list_archive_events',{id});assert.equal(history.events.length,1);assert.equal(history.events[0].source,'web');
 const noop=await v.call('update_archive',{id,expected_version:detail.version,name:detail.name,contacts:detail.contacts,links:detail.links,request_id:randomUUID()});assert.equal(noop.changed,false);
 assert.equal((await v.call('list_archive_events',{id})).events.length,1);assert.equal((await v.call('get_archive',{id})).archive.updated_at,detail.updated_at);
 checks.push('unchanged profile does not alter version, activity time or history');
 const mutation={id,expected_version:detail.version,name:detail.name+' 已编辑',contacts:[],links:[],request_id:randomUUID()};
 const race=await Promise.all([v.http('/archives/update',mutation),v.http('/archives/update',{...mutation,name:detail.name+' 冲突',request_id:randomUUID()})]);assert.equal(race.filter(r=>r.status===200).length,1);assert.equal(race.filter(r=>r.status===409).length,1);
 const events=await v.call('list_archive_events',{id,limit:1});assert.equal(events.events.length,1);assert.ok(events.next_cursor);assert.equal((await v.call('list_archive_events',{id,before:events.next_cursor,limit:1})).events.length,1);
 checks.push('concurrent profile edits commit once and the event stream paginates without repeats');
 const org=await v.call('create_archive',{...input,type:'org',request_id:randomUUID()});assert.notEqual(org.id,id);
 const sameName=await v.call('create_archive',{...input,request_id:randomUUID()});assert.notEqual(sameName.id,id);
 const people=await v.call('list_archives',{type:'person',query:input.name,limit:1});assert.equal(people.archives.length,1);assert.ok(people.next_cursor);const page2=await v.call('list_archives',{type:'person',query:input.name,limit:1,before:people.next_cursor});assert.notEqual(page2.archives[0].id,people.archives[0].id);assert.ok(page2.archives.every(a=>a.type==='person'));
 assert.equal((await v.http('/archives/update',{...mutation,type:'org',request_id:randomUUID()})).status,400);
 assert.equal((await v.http('/archives/update',{id,expected_version:1,name:'不应清空资料',request_id:randomUUID()})).status,400);
 assert.equal((await v.http('/archives/create',{...input,name:' ',request_id:randomUUID()})).status,400);
 assert.equal((await v.http('/archives/create',{...input,links:[{label:'bad',url:'javascript:alert(1)'}],request_id:randomUUID()})).status,400);
 checks.push('types remain fixed, duplicate display names are allowed, queries paginate and unsafe links or blank names are rejected');
}finally{await v.close(checks);}
