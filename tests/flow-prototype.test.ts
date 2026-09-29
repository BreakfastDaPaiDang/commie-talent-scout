import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceFlow,applyFlow,flowActors,initialFlow} from '../prototypes/frontend/src/flow-model.ts';
const [zhou,shen,admin]=flowActors;

test('prototype separates audit completion, explicit membership and voluntary onboarding ownership while preserving the archive',()=>{
 let s=initialFlow();const tags=s.people[0].tags,notes=s.notes;
 s=applyFlow(s,{type:'claim',taskId:'review-lin'},zhou);
 assert.throws(()=>applyFlow(s,{type:'claim',taskId:'review-lin'},shen),/已被领取/);
 assert.throws(()=>applyFlow(s,{type:'complete',taskId:'review-lin'},shen),/当前负责人/);
 s=applyFlow(s,{type:'complete',taskId:'review-lin',body:'虚构审核结论，确认参与意愿。'},zhou);
 assert.equal(s.people[0].member,false);assert.equal(s.tasks.filter(t=>t.personId==='p1').length,1);
 s=applyFlow(s,{type:'join',personId:'p1'},shen);
 assert.equal(s.people.filter(p=>p.id==='p1').length,1);assert.equal(s.people[0].member,true);assert.deepEqual(s.people[0].tags,tags);assert.deepEqual(s.notes.find(n=>n.id===notes[0].id),notes[0]);
 const onboarding=s.tasks.find(t=>t.personId==='p1'&&t.type==='onboarding')!;assert.equal(onboarding.ownerId,null);
 const same=applyFlow(s,{type:'join',personId:'p1'},zhou);assert.deepEqual(same,s);
 s=applyFlow(s,{type:'claim',taskId:onboarding.id},shen);s=applyFlow(s,{type:'complete',taskId:onboarding.id},shen);
 assert.equal(s.tasks.find(t=>t.id===onboarding.id)!.result,'completed');assert.equal(s.people[0].member,true);
});
test('prototype supports surrender, explicit deadlines, other-member pickup and readonly history',()=>{
 let s=applyFlow(initialFlow(),{type:'claim',taskId:'review-lin'},zhou);
 s=applyFlow(s,{type:'release',taskId:'review-lin',deadline:'2026-10-03T18:00:00+08:00'},zhou);
 let t=s.tasks.find(t=>t.id==='review-lin')!;assert.equal(t.open,true);assert.equal(t.ownerId,null);assert.equal(t.result,undefined);
 s=applyFlow(s,{type:'claim',taskId:t.id},shen);const oldDeadline=s.tasks.find(x=>x.id===t.id)!.deadline;
 s=applyFlow(s,{type:'comment',taskId:t.id,body:'明天继续核对。'},shen);assert.equal(s.tasks.find(x=>x.id===t.id)!.deadline,oldDeadline);
 s=applyFlow(s,{type:'extend',taskId:t.id,deadline:'2026-10-12T18:00:00+08:00'},shen);s=applyFlow(s,{type:'complete',taskId:t.id},shen);
 assert.throws(()=>applyFlow(s,{type:'comment',taskId:t.id,body:'关闭后直接追加'},zhou),/已关闭/);
 s=applyFlow(s,{type:'reopen',taskId:t.id,deadline:'2026-10-13T18:00:00+08:00'},admin);t=s.tasks.find(x=>x.id===t.id)!;
 assert.equal(t.ownerId,null);assert.equal(t.open,true);assert.ok(t.history.some(e=>e.result==='completed'));
});
test('prototype keeps failure history after reopening, expires unclaimed/claimed separately, and never infers membership from tasks',()=>{
 let s=initialFlow();s=applyFlow(s,{type:'reopen',taskId:'monthly-old',deadline:'2026-10-02T18:00:00+08:00'},zhou);
 s=applyFlow(s,{type:'complete',taskId:'monthly-old'},zhou);assert.ok(s.tasks.find(t=>t.id==='monthly-old')!.history.some(e=>e.result==='failed'));
 for(let i=0;i<9;i++)s=advanceFlow(s);
 assert.equal(s.tasks.find(t=>t.id==='review-lin')!.result,'unclaimed');assert.equal(s.tasks.find(t=>t.id==='onboard-cen')!.result,'failed');
 assert.equal(s.people.find(p=>p.id==='p1')!.member,false);assert.equal(s.people.find(p=>p.id==='p2')!.member,true);
 assert.throws(()=>applyFlow(s,{type:'claim',taskId:'review-lin'},zhou),/已关闭/);
 s=applyFlow(s,{type:'join',personId:'p4'},zhou);assert.ok(Date.parse(s.tasks.find(t=>t.personId==='p4')!.deadline)>Date.parse(s.now));
});
