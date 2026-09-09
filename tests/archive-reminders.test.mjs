import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {Reading} from '../app/server/reading.ts';
import {Drafts} from '../app/server/drafts.ts';
const DAY=86400000,NOW=Date.parse('2026-10-20T12:00:00.000Z');
function setup(t){t.mock.timers.enable({apis:['Date'],now:NOW});const f=fixture();t.after(f.close);return {...f,s:new Archives(f.env,f.actor,'web')};}
async function add(f,{name=uuid(),type='person',status='视奸观察',age=0}={}){const r=await f.s.create({type,name,status,member_ids:['引荐中（待人事组接触）','人事审核','已加入待对接','组织交流'].includes(status)?[f.actor.id]:[],request_id:uuid()});f.sqlite.prepare('UPDATE archives SET updated_at=? WHERE id=?').run(new Date(NOW-age).toISOString(),r.id);return r.id;}

test('reminders use strict 7/30-day boundaries for the three HR states and all other open people/organizations',async t=>{
 const f=setup(t);
 for(const [type,status,days] of [['person','视奸观察',30],['person','个人接触',30],['person','引荐中（待人事组接触）',7],['person','人事审核',7],['person','已加入待对接',7],['org','组织交流',30],['org','视奸观察',30]]){
  const at=await add(f,{type,status,age:days*DAY}),past=await add(f,{type,status,age:days*DAY+1});
  const rows=(await f.s.list({type})).archives;assert.equal(rows.find(a=>a.id===at).update_reminder.overdue,false);assert.equal(rows.find(a=>a.id===past).update_reminder.overdue,true);assert.equal(rows.find(a=>a.id===past).update_reminder.threshold_days,days);assert.equal((await f.s.detail(past)).archive.update_reminder.overdue,true);
 }
 const closed=await add(f,{status:'已弃用',age:90*DAY});assert.equal((await f.s.detail(closed)).archive.update_reminder.overdue,false);
});

test('overdue-first sorting happens before pagination; earliest deadline wins, normal activity order and snapshot boundaries remain stable',async t=>{
 const f=setup(t),ordinary=await add(f,{name:'普通已超期',age:32*DAY}),hr=await add(f,{name:'人事超期更久',status:'人事审核',age:12*DAY}),hrTie=await add(f,{name:'同一到期时间',status:'已加入待对接',age:12*DAY}),edge=await add(f,{name:'即将超期',status:'人事审核',age:7*DAY}),fresh=await add(f,{name:'最新',age:0});
 const expected=[...[hr,hrTie].sort().reverse(),ordinary,fresh,edge],seen=[];let before;
 do{const r=await f.s.list({type:'person',limit:1,...(before?{before}:{})});seen.push(r.archives[0].id);before=r.next_cursor;t.mock.timers.setTime(NOW+2*DAY);}while(before);
 assert.deepEqual(seen,expected);const refreshed=(await f.s.list({type:'person'})).archives;assert.equal(refreshed.find(a=>a.id===edge).update_reminder.overdue,true);assert.ok(refreshed.findIndex(a=>a.id===edge)<refreshed.findIndex(a=>a.id===fresh));
 await assert.rejects(f.s.list({type:'person',before:'bad'}),e=>e.code==='INVALID_CURSOR');
});

test('reading and unchanged saves keep alarms, real observations clear them, closure removes them and reopening starts a new period',async t=>{
 const f=setup(t),id=await add(f,{age:40*DAY}),before=(await f.s.detail(id)).archive;
 await new Reading(f.env,f.actor).summary();await f.s.events({id});await f.s.update({id,expected_version:1,name:before.name,contacts:[],links:[],request_id:uuid()});await new Drafts(f.env,f.actor).save({archive_id:id,expected_version:0,body:'尚未发布的草稿',occurred_at:null,request_id:uuid()});assert.equal((await f.s.detail(id)).archive.update_reminder.overdue,true);
 await new Observations(f.env,f.actor,'web').create({archive_id:id,body:'已重新联系并更新实际进展',request_id:uuid()});assert.equal((await f.s.detail(id)).archive.update_reminder.overdue,false);
 await f.s.setState({id,expected_version:2,status:'已弃用',member_ids:[],request_id:uuid()});t.mock.timers.setTime(NOW+60*DAY);assert.equal((await f.s.detail(id)).archive.update_reminder.overdue,false);
 await f.s.reopen({id,expected_version:3,status:'人事审核',member_ids:[f.actor.id],request_id:uuid()});const reopened=(await f.s.detail(id)).archive;assert.equal(reopened.update_reminder.overdue,false);assert.equal(reopened.update_reminder.threshold_days,7);
});

test('alarm priority respects search, responsible scope and deleted/closed filters without changing counts',async t=>{
 const f=setup(t),mine=await add(f,{name:'目标人事',status:'引荐中（待人事组接触）',age:8*DAY}),unassigned=await add(f,{name:'目标普通',age:90*DAY}),closed=await add(f,{name:'目标关闭',status:'已入伙',age:100*DAY});
 const list=await f.s.list({type:'person',query:'目标',limit:1});assert.equal(list.counts.all,3);assert.equal(list.counts.mine,1);assert.equal(list.archives[0].id,unassigned);
 assert.deepEqual((await f.s.list({type:'person',query:'目标',scope:'mine'})).archives.map(a=>a.id),[mine]);assert.deepEqual((await f.s.list({type:'person',closed:'closed'})).archives.map(a=>a.id),[closed]);
 f.actor.role='admin';f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);await f.s.setDeleted({id:unassigned,expected_version:1,request_id:uuid()},true);f.sqlite.prepare('UPDATE archives SET updated_at=? WHERE id=?').run(new Date(NOW-200*DAY).toISOString(),unassigned);
 const trash=await f.s.list({type:'person',deleted:true});assert.equal(trash.archives[0].update_reminder.overdue,false);assert.equal(trash.archives[0].update_reminder.due_at,null);assert.ok(!(await f.s.list({type:'person'})).archives.some(a=>a.id===unassigned));
});
