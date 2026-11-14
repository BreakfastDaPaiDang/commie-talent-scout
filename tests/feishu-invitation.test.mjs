import {historicalArchive} from './personnel-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {feishuInvitationExpired} from '../app/shared/feishu-invitation.ts';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';

test('Feishu invitation expires after December 20 in Shanghai, independent of machine timezone',()=>{
 assert.equal(feishuInvitationExpired(Date.parse('2026-12-20T23:59:59.999+08:00')),false);
 assert.equal(feishuInvitationExpired(Date.parse('2026-12-21T00:00:00+08:00')),true);
 assert.equal(feishuInvitationExpired(Date.parse('2027-02-20T00:00:00+08:00')),true);
 assert.equal(feishuInvitationExpired(Date.now(),'invalid'),true);
});
test('member maintenance cannot masquerade as joining, and direct joining is rejected',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web');
 const a=await historicalArchive(f,archives,{type:'person',name:'已有社员',status:'已入伙',request_id:randomUUID()});
 const input={id:a.id,expected_version:a.version,status:'已入伙',member_ids:[],request_id:randomUUID()};assert.notEqual((await archives.setState(input)).membership_joined,true);
 const b=await archives.create({type:'person',name:'新人物',request_id:randomUUID()});await assert.rejects(archives.setState({...input,id:b.id,request_id:randomUUID()}),{code:'PERSONNEL_RECOGNITION_REQUIRED'});
});
