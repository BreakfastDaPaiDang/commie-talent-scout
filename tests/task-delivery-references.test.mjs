import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';

for(const source of ['web','mcp'])test(`${source}: personnel deliveries require archive observations regardless of labels or result`,async t=>{
 const f=fixture();t.after(f.close);
 const service=new WorkTasks(f.env,f.actor,source),archives=new Archives(f.env,f.actor,source),observations=new Observations(f.env,f.actor,source);
 const archive=await archives.create({type:'person',name:'虚构引用要求',request_id:uuid()});
 const other=await archives.create({type:'person',name:'另一个档案',request_id:uuid()});
 const correct=await observations.create({archive_id:archive.id,body:'已尝试联系，暂未收到回复。',request_id:uuid()});
 const wrong=await observations.create({archive_id:other.id,body:'其他对象的观察',request_id:uuid()});
 for(const [kind,automation_rule] of [['audit',null],['onboarding',null],['monthly','member.monthly_follow_up'],['custom','archive.follow_up'],['custom',null]]){
  const required=kind!=='custom'||!!automation_rule;
  const task=await service.create({archive_id:archive.id,kind:kind==='monthly'?'custom':kind,labels:required?['随意标签']:['人事审核','月度沟通','接触跟进'],title:'虚构交付',purpose:'验证引用要求',delivery:'记录观察',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
  // Model persisted monthly/follow-up tasks, including existing tasks created before this rule.
  f.sqlite.prepare('UPDATE work_tasks SET kind=?,automation_rule=? WHERE id=?').run(kind,automation_rule,task.id);
  const claimed=await service.claim({id:task.id,expected_version:task.version,request_id:uuid()});
  assert.equal((await service.detail(task.id)).task.requires_observation_reference,required);
  assert.equal((await service.list({archive_id:archive.id})).tasks.find(t=>t.id===task.id).requires_observation_reference,required);
  const input={id:task.id,expected_version:claimed.version,result_kind:'unable_to_contact',result_text:'如实交付',request_id:uuid()};
  if(required){
   await service.addComment({task_id:task.id,body:'评论不能代替档案观察',request_id:uuid()});
   // Comments don't change task version.
   for(const result_kind of ['completed','continue','not_suitable','unable_to_contact','joined','discarded'])await assert.rejects(service.complete({...input,result_kind,request_id:uuid()}),{code:'OBSERVATION_REFERENCE_REQUIRED'});
   assert.equal((await service.detail(task.id)).task.status,'open');
   assert.equal((await service.detail(task.id)).task.version,claimed.version);
   await assert.rejects(service.complete({...input,references:[{observation_id:wrong.id,content_version:1}]}),{code:'REFERENCE_NOT_VISIBLE'});
   await assert.rejects(service.complete({...input,references:[{observation_id:correct.id,content_version:999}]}),{code:'REFERENCE_NOT_VISIBLE'});
   input.references=[{observation_id:correct.id,content_version:1}];
  }
  const completed=await service.complete(input);assert.equal(completed.status,'completed');
  assert.equal((await service.detail(task.id)).task.result_references.length,required?1:0);
  assert.equal((await service.complete(input)).replayed,true);
 }
});
