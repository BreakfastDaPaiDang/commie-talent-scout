import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Members} from '../app/server/members.ts';
import {Archives} from '../app/server/archives.ts';

test('member lists hide frozen accounts before pagination, while explicit frozen view can restore their existing identity',async t=>{
 const f=fixture();t.after(f.close);f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);const actor={...f.actor,role:'admin'},s=new Members(f.env,actor,'web'),ids=[];
 for(const username of ['AAA','bbb','ccc']){const id=uuid();ids.push(id);f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,'2026-01-01T00:00:00Z')").run(id,username,username);}
 const archive=await new Archives(f.env,actor,'web').create({type:'person',name:'虚构历史归属',status:'人事审核',member_ids:[ids[0]],request_id:uuid()});
 await s.setFrozen({id:ids[0],expected_version:1,frozen:true,request_id:uuid()});let cursor,seen=[];
 do{const r=await s.list({limit:1,...(cursor?{before:cursor}:{})});seen.push(...r.members);cursor=r.next_cursor;}while(cursor);
 assert.deepEqual(seen.map(m=>m.username),['bbb','ccc','fixture']);assert.ok(seen.every(m=>!m.frozen));assert.equal((await s.list({state:'frozen'})).members[0].id,ids[0]);assert.equal((await s.list({state:'all'})).members.length,4);
 const historical=(await new Archives(f.env,actor,'web').detail(archive.id)).archive;assert.equal(historical.members[0].id,ids[0]);assert.equal(historical.members[0].frozen,true);
 const frozen=(await s.detail(ids[0])).member;await s.setFrozen({id:ids[0],expected_version:frozen.version,frozen:false,request_id:uuid()});assert.equal((await s.list({state:'frozen'})).members.length,0);assert.equal((await s.list({limit:1})).members[0].id,ids[0]);
});
