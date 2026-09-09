import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {personStates,orgStates} from '../app/shared/archive-states.ts';

test('associated scope includes current members in every person and organization state, with matching counts and pagination',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web');
 for(const [type,states] of [['person',personStates],['org',orgStates]]){
  const expected=[];for(const status of states){const a=await s.create({type,name:'关联范围 '+status,status,member_ids:[f.actor.id],request_id:uuid()});expected.push(a.id);}
  await s.create({type,name:'未关联的创建者',request_id:uuid()});
  let before,seen=[];do{const r=await s.list({type,scope:'mine',limit:2,...(before?{before}:{})});if(!before){assert.equal(r.counts.mine,states.length);assert.equal(r.counts.all,states.length+1);}seen.push(...r.archives.map(a=>a.id));before=r.next_cursor;}while(before);
  assert.deepEqual(seen.sort(),expected.sort());const closed=await s.list({type,scope:'mine',closed:'closed'});assert.equal(closed.archives.length,type==='person'?2:1);assert.equal(closed.counts.mine,closed.archives.length);
  const selected=await s.list({type,scope:'mine',status:'个人接触',query:'关联范围',member_id:f.actor.id});assert.equal(selected.archives.length,1);assert.equal(selected.counts.mine,1);
 }
});

test('associated scope drops old-state and removed memberships and keeps deleted archives outside the ordinary scope',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),a=await s.create({type:'person',name:'关联变化',status:'视奸观察',member_ids:[f.actor.id],request_id:uuid()});
 assert.equal((await s.list({type:'person',scope:'mine'})).archives.length,1);
 await s.setState({id:a.id,expected_version:1,status:'个人接触',member_ids:[],request_id:uuid()});assert.equal((await s.list({type:'person',scope:'mine'})).archives.length,0);assert.ok((await s.get(a.id)).bindings['视奸观察'].some(m=>m.id===f.actor.id));
 await s.setState({id:a.id,expected_version:2,status:'个人接触',member_ids:[f.actor.id],request_id:uuid()});assert.equal((await s.list({type:'person',scope:'mine'})).counts.mine,1);
 await s.setState({id:a.id,expected_version:3,status:'个人接触',member_ids:[],request_id:uuid()});assert.equal((await s.list({type:'person',scope:'mine'})).counts.mine,0);
 await s.setState({id:a.id,expected_version:4,status:'个人接触',member_ids:[f.actor.id],request_id:uuid()});f.actor.role='admin';f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);await s.setDeleted({id:a.id,expected_version:5,request_id:uuid()},true);assert.equal((await s.list({type:'person',scope:'mine'})).counts.mine,0);assert.equal((await s.list({type:'person',scope:'mine',deleted:true})).archives.length,1);
});
