import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';

async function fresh(f,id){const o=await new Observations(f.env,f.actor,'web').create({archive_id:id,body:'本轮新观察',request_id:uuid()});return [{observation_id:o.id,content_version:1}];}
async function setup(f,source='web'){
 const archives=new Archives(f.env,f.actor,source),tasks=new WorkTasks(f.env,f.actor,source);
 const a=await archives.create({type:'person',name:'虚构人事交付闭环',request_id:uuid()});
 const referral=await tasks.refer({archive_id:a.id,expected_version:a.version,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 const task=await tasks.claim({id:referral.task_id,expected_version:1,request_id:uuid()});
 const observation=await new Observations(f.env,f.actor,source).create({archive_id:a.id,body:'虚构审核与对接观察，结论由负责人明确提交。',request_id:uuid()});
 const input={id:task.id,expected_version:task.version,result_kind:'audit_passed',result_text:'审核通过',references:[{observation_id:observation.id,content_version:1}],request_id:uuid()};
 return {archives,tasks,id:a.id,task,input};
}

for(const source of ['web','mcp'])test(`${source}: explicit personnel delivery advances audit, onboarding and membership atomically`,async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f,source),before=await s.archives.get(s.id);
 const result=await s.tasks.complete(s.input);
 assert.equal(result.archive_status,'已加入待对接');assert.equal(result.archive_version,before.version+1);assert.equal(result.archive_advanced,true);
 const a=await s.archives.get(s.id);assert.equal(a.person_role,'external');assert.equal(a.closed,false);assert.equal(a.name,before.name);
 const next=(await s.tasks.detail(result.next_task_id)).task;
 assert.equal(next.kind,'onboarding');assert.equal(next.source,'rule');assert.equal(next.status,'open');assert.equal(next.owner_id,null);
 assert.equal(next.initiator_id,f.actor.id);assert.equal(next.archive_id,s.id);assert.equal(next.priority,'P1');
 assert.ok(Math.abs(Date.parse(next.deadline_at)-Date.now()-7*86400000)<10000);
 assert.deepEqual(await s.tasks.complete(s.input),{...result,replayed:true});
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_tasks WHERE archive_id=? AND kind='onboarding'").get(s.id).n,1);
 const otherEntry=new WorkTasks(f.env,f.actor,source==='web'?'mcp':'web');
 const claimed=await otherEntry.claim({id:next.id,expected_version:next.version,request_id:uuid()});
 const nextRefs=await fresh(f,s.id);
 const finish=await otherEntry.complete({...s.input,references:nextRefs,id:next.id,expected_version:claimed.version,result_kind:'onboarding_completed',result_text:'对接完成',request_id:uuid()});
 assert.equal(finish.archive_status,'已入伙');assert.equal(finish.next_task_id,null);
 const joined=await s.archives.get(s.id);assert.equal(joined.person_role,'member');assert.equal(joined.member_status,'可接工作');assert.equal(joined.closed,false);
 assert.equal((await s.archives.list({type:'person',person_scope:'external'})).archives.some(a=>a.id===s.id),false);
 assert.equal((await s.archives.list({type:'person',person_scope:'members'})).archives.some(a=>a.id===s.id),true);
 assert.deepEqual((await otherEntry.detail(next.id)).task.result_references,[{...nextRefs[0],archive_id:s.id}]);
 const events=f.sqlite.prepare("SELECT after_json FROM archive_events WHERE archive_id=? AND kind='archive.state_changed' ORDER BY seq").all(s.id).map(e=>JSON.parse(e.after_json));
 assert.deepEqual(events.map(e=>e.status),['人事审核','已加入待对接','已入伙']);assert.equal(events[1].task_id,next.id);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mutation_guards').get().n,0);
});

for(const result_kind of ['completed','continue','unable_to_contact','not_suitable','joined','discarded'])test(`legacy or non-approval result ${result_kind} does not infer approval`,async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),before=await s.archives.get(s.id);
 await s.tasks.complete({...s.input,result_kind,...(result_kind==='unable_to_contact'?{next_contact_at:'2099-01-01T00:00:00.000Z'}:{})});
 const after=await s.archives.get(s.id);assert.equal(after.status,'人事审核');assert.equal(after.version,before.version);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_tasks WHERE archive_id=? AND kind='onboarding'").get(s.id).n,0);
});

test('labels and manual audit tasks cannot approve an archive, nor can an audit skip onboarding',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f);
 for(const kind of ['audit','onboarding','custom']){
  const task=await s.tasks.create({archive_id:s.id,kind,labels:['人事审核'],title:'普通手动任务',purpose:'记录工作',delivery:'交付结果',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
  const claimed=await s.tasks.claim({id:task.id,expected_version:1,request_id:uuid()});
  const currentRefs=await fresh(f,s.id);await assert.rejects(s.tasks.complete({...s.input,references:currentRefs,id:task.id,expected_version:claimed.version}),{code:'INVALID_PERSONNEL_RESULT'});
 }
 await assert.rejects(s.tasks.complete({...s.input,result_kind:'onboarding_completed'}),{code:'INVALID_PERSONNEL_RESULT'});
 await assert.rejects(s.tasks.complete({...s.input,references:[]}),{code:'OBSERVATION_REFERENCE_REQUIRED'});
 assert.equal((await s.archives.get(s.id)).status,'人事审核');assert.equal((await s.tasks.detail(s.task.id)).task.status,'open');
});

test('pre-advanced and reopened deliveries do not regress archives, duplicate onboarding or reset member state',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f);let archive=await s.archives.get(s.id);
 const advanced=await s.tasks.confirmMembership({archive_id:s.id,expected_version:archive.version,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 const result=await s.tasks.complete(s.input);assert.equal(result.archive_advanced,false);assert.equal(result.archive_version,advanced.archive_version);
 archive=await s.archives.get(s.id);await s.archives.setState({id:s.id,expected_version:archive.version,status:'已入伙',member_status:'请假',member_ids:[],request_id:uuid()});
 const reopened=await s.tasks.reopen({id:s.task.id,expected_version:result.version,owner_mode:'keep',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 s.input.references=await fresh(f,s.id);const before=await s.archives.get(s.id);
 const again=await s.tasks.complete({...s.input,expected_version:reopened.version,request_id:uuid()});
 assert.equal(again.archive_status,'已入伙');assert.equal(again.archive_advanced,false);assert.equal((await s.archives.get(s.id)).version,before.version);assert.equal((await s.archives.get(s.id)).member_status,'请假');
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_tasks WHERE archive_id=? AND kind='onboarding'").get(s.id).n,1);
});

test('withdrawn or earlier-round tasks cannot advance the current personnel stage',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),archive=await s.archives.get(s.id);
 const withdrawn=await s.archives.setState({id:s.id,expected_version:archive.version,status:'个人接触',member_ids:[],request_id:uuid()});
 const oldTask=(await s.tasks.detail(s.task.id)).task;
 const reopened=await s.tasks.reopen({id:oldTask.id,expected_version:oldTask.version,owner_mode:'keep',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 s.input.references=await fresh(f,s.id);await assert.rejects(s.tasks.complete({...s.input,expected_version:reopened.version,request_id:uuid()}),{code:'PERSONNEL_STAGE_CHANGED'});
 await s.tasks.cancel({id:oldTask.id,expected_version:reopened.version,reason:'结束旧审核',request_id:uuid()});
 const current=await s.tasks.refer({archive_id:s.id,expected_version:(await s.archives.get(s.id)).version,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 const old=(await s.tasks.detail(oldTask.id)).task;
 const stale=await s.tasks.reopen({id:old.id,expected_version:old.version,owner_mode:'keep',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 s.input.references=await fresh(f,s.id);await assert.rejects(s.tasks.complete({...s.input,expected_version:stale.version,request_id:uuid()}),{code:'PERSONNEL_STAGE_CHANGED'});
 assert.equal((await s.tasks.detail(current.task_id)).task.status,'open');assert.equal((await s.archives.get(s.id)).status,'人事审核');
});

test('SQL failure rolls back task, archive, successor, histories and receipt together',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),before=await s.archives.get(s.id);
 const countEvents=()=>f.sqlite.prepare('SELECT count(*) n FROM archive_events WHERE archive_id=?').get(s.id).n,beforeEvents=countEvents();
 f.sqlite.exec("CREATE TRIGGER fail_personnel_completion BEFORE UPDATE ON work_tasks WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'injected completion failure'); END");
 await assert.rejects(s.tasks.complete(s.input),/injected completion failure/);
 assert.equal((await s.archives.get(s.id)).version,before.version);assert.equal((await s.tasks.detail(s.task.id)).task.status,'open');assert.equal(countEvents(),beforeEvents);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_tasks WHERE archive_id=? AND kind='onboarding'").get(s.id).n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM commands WHERE request_id=?').get(s.input.request_id).n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mutation_guards').get().n,0);
 f.sqlite.exec('DROP TRIGGER fail_personnel_completion');assert.equal((await s.tasks.complete(s.input)).archive_advanced,true);
});

for(const change of ['version','closed','deleted','frozen','revoked','owner'])test(`transaction rechecks ${change} after preparing personnel delivery`,async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),batch=f.env.DB.batch;let injected=false;
 f.env.DB.batch=async statements=>{
  if(!injected){injected=true;
   if(change==='version')f.sqlite.prepare('UPDATE archives SET version=version+1 WHERE id=?').run(s.id);
   if(change==='closed')f.sqlite.prepare('UPDATE archives SET closed=1 WHERE id=?').run(s.id);
   if(change==='deleted')f.sqlite.prepare('UPDATE archives SET deleted=1 WHERE id=?').run(s.id);
   if(change==='frozen')f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.actor.id);
   if(change==='revoked')f.sqlite.prepare('UPDATE credentials SET revoked_at=? WHERE id=?').run(new Date().toISOString(),f.actor.credential_id);
   if(change==='owner')f.sqlite.prepare('UPDATE work_tasks SET owner_id=NULL WHERE id=?').run(s.task.id);
  }
  return batch(statements);
 };
 await assert.rejects(s.tasks.complete(s.input),{code:'PRECONDITION_CHANGED'});
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(s.task.id).status,'open');
 assert.equal(f.sqlite.prepare('SELECT status FROM archives WHERE id=?').get(s.id).status,'人事审核');
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_tasks WHERE archive_id=? AND kind='onboarding'").get(s.id).n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM commands WHERE request_id=?').get(s.input.request_id).n,0);
});
