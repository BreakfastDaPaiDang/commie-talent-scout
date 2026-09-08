import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('bindings'),checks=[],fixtures=[];
try{
 for(const suffix of ['A','B'])fixtures.push(await v.call('create_member',{username:'binding-'+randomUUID().slice(0,8),name:'虚构关联成员 '+suffix,role:'member',temporary_password:randomBytes(24).toString('hex'),request_id:randomUUID()}));
 const memberIds=fixtures.map(m=>m.id),created=await v.call('create_archive',{type:'person',name:'虚构多人负责与冻结验收',status:'引荐中（待人事组接触）',member_ids:memberIds,request_id:randomUUID()});
 await v.call('set_member_frozen',{id:fixtures[0].id,expected_version:1,frozen:true,request_id:randomUUID()});
 let a=(await v.call('get_archive',{id:created.id})).archive;assert.equal(a.members.length,2);assert.equal(a.members.find(m=>m.id===fixtures[0].id).frozen,true);
 const list=await v.call('list_archives',{type:'person',query:a.name});assert.equal(list.archives.find(x=>x.id===a.id).members.length,2);
 checks.push('freezing a member preserves stable responsibility and marks it in both archive detail and list');
 const denied=await v.http('/archives/create',{type:'person',name:'不应分配冻结成员',status:'人事审核',member_ids:[fixtures[0].id],request_id:randomUUID()});assert.equal(denied.status,409);assert.equal(denied.body.error.code,'MEMBER_FROZEN');
 const closed=await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'已弃用',member_ids:memberIds,request_id:randomUUID()});
 a=(await v.call('get_archive',{id:a.id})).archive;assert.equal(a.closed,true);assert.equal(a.members.length,2);assert.equal(a.members.find(m=>m.id===fixtures[0].id).frozen,true);
 await v.call('reopen_archive',{id:a.id,expected_version:closed.version,status:'引荐中（待人事组接触）',member_ids:memberIds,request_id:randomUUID()});
 a=(await v.call('get_archive',{id:a.id})).archive;assert.equal(a.closed,false);assert.equal(a.members.length,2);
 checks.push('new frozen assignments are rejected while close/reopen can retain existing frozen associations');
 const directory=await v.call('search_members',{query:'虚构关联成员',limit:1});assert.equal(directory.members.length,1);assert.ok(directory.next_cursor);const next=await v.call('search_members',{query:'虚构关联成员',before:directory.next_cursor,limit:1});assert.notEqual(next.members[0].id,directory.members[0].id);assert.equal('username'in directory.members[0],false);
 checks.push('searchable member directory paginates without exposing account management fields');
}finally{
 for(const f of fixtures){const m=(await v.call('get_member',{id:f.id})).member;if(!m.frozen)await v.call('set_member_frozen',{id:m.id,expected_version:m.version,frozen:true,request_id:randomUUID()});}
 await v.close(checks);
}
