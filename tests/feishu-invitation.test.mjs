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
test('membership notice flag denotes a real transition, not ordinary member maintenance',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web');
 const a=await archives.create({type:'person',name:'飞书入职验收',request_id:randomUUID()});
 const input={id:a.id,expected_version:a.version,status:'已入伙',member_ids:[],request_id:randomUUID()};
 const joined=await archives.setState(input);assert.equal(joined.membership_joined,true);
 assert.equal((await archives.setState(input)).membership_joined,true); // Original receipt supports lost-response recovery.
 const maintained=await archives.setState({...input,expected_version:joined.version,request_id:randomUUID()});assert.notEqual(maintained.membership_joined,true);
 await assert.rejects(archives.setState({...input,request_id:randomUUID()}),{code:'VERSION_CONFLICT'});
});
