import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {Archives} from '../app/server/archives.ts';

test('work task creation is separate from MCP review tasks and can be claimed once',async t=>{
 const f=fixture();t.after(f.close);const service=new WorkTasks(f.env,f.actor,'mcp');
 const created=await service.create({kind:'audit',title:'人事审核',purpose:'了解是否适合继续接触',delivery:'提交观察与结论',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 assert.equal(created.status,'open');assert.equal(created.owner_id,null);
 const listed=await service.list({scope:'all'});assert.equal(listed.tasks.length,1);
 const claimed=await service.claim({id:created.id,expected_version:created.version,request_id:uuid()});assert.equal(claimed.owner_id,f.actor.id);
 await assert.rejects(service.claim({id:created.id,expected_version:created.version,request_id:uuid()}),{code:'VERSION_CONFLICT'});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mcp_tasks').get().n,0);
});

test('due push records only matching active members and never assigns the task',async t=>{
 const f=fixture();t.after(f.close);const memberId=uuid(),at=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,qq,created_at) VALUES(?,?,?,'member','fixture',0,'00000',?)").run(memberId,'recipient','接收人',at);
 f.sqlite.prepare("INSERT INTO member_work_preferences(member_id,all_work,kinds_json,version,created_at,updated_at) VALUES(?,0,'[\"audit\"]',1,?,?)").run(memberId,at,at);
 const service=new WorkTasks(f.env,f.actor,'mcp'),task=await service.create({kind:'audit',title:'审核',purpose:'判断',delivery:'观察记录',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 const pushed=await service.duePushes(task.created_at);assert.equal(pushed.count,1);
 const push=f.sqlite.prepare('SELECT member_id,stage FROM work_task_pushes WHERE task_id=?').get(task.id);assert.equal(push.member_id,memberId);assert.equal(push.stage,'initial');
 assert.equal(f.sqlite.prepare('SELECT owner_id FROM work_tasks WHERE id=?').get(task.id).owner_id,null);
 assert.equal((await service.duePushes(task.created_at)).count,0);
});

test('administrator assignment records a reason and stops the unowned state',async t=>{
 const f=fixture();t.after(f.close);f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';
 const target=uuid(),at=new Date().toISOString();f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,qq,created_at) VALUES(?,?,?,'member','fixture',0,'00000',?)").run(target,'assigned','被指派人',at);
 const service=new WorkTasks(f.env,f.actor,'web'),task=await service.create({kind:'onboarding',title:'入社对接',purpose:'说明后续安排',delivery:'留下交接记录',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 const assigned=await service.assign({id:task.id,member_id:target,expected_version:task.version,reason:'本周负责入社对接',request_id:uuid()});assert.equal(assigned.owner_id,target);
 const event=f.sqlite.prepare("SELECT kind,reason FROM work_task_events WHERE task_id=? ORDER BY created_at DESC LIMIT 1").get(task.id);assert.equal(event.kind,'task.assigned');assert.equal(event.reason,'本周负责入社对接');
});

test('only the current owner can complete or release a task, and both actions keep history',async t=>{
 const f=fixture();t.after(f.close);const service=new WorkTasks(f.env,f.actor,'mcp');
 const task=await service.create({kind:'audit',title:'审核',purpose:'了解情况',delivery:'交代结论',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 await assert.rejects(service.complete({id:task.id,expected_version:task.version,result_kind:'completed',result_text:'尚未接取',request_id:uuid()}),{code:'TASK_OWNER_REQUIRED'});
 const claimed=await service.claim({id:task.id,expected_version:task.version,request_id:uuid()});
 const released=await service.release({id:task.id,expected_version:claimed.version,deadline_at:'2099-02-01T00:00:00.000Z',request_id:uuid()});assert.equal(released.owner_id,null);
 const reclaimed=await service.claim({id:task.id,expected_version:released.version,request_id:uuid()});
 const completed=await service.complete({id:task.id,expected_version:reclaimed.version,result_kind:'unable_to_contact',result_text:'本次未取得联系，保留后续跟进事项。',request_id:uuid()});assert.equal(completed.status,'completed');
 const detail=await service.detail(task.id);assert.deepEqual(detail.events.map(e=>e.kind),['task.completed','task.claimed','task.released','task.claimed','task.created']);
});

test('task creators can cancel an unclaimed task and the reason remains in history',async t=>{
 const f=fixture();t.after(f.close);const service=new WorkTasks(f.env,f.actor,'mcp');
 const task=await service.create({kind:'custom',title:'取消测试',purpose:'不再需要',delivery:'无需交付',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 const cancelled=await service.cancel({id:task.id,expected_version:task.version,reason:'需求已经合并到其他工作',request_id:uuid()});assert.equal(cancelled.status,'cancelled');
 const detail=await service.detail(task.id);assert.equal(detail.events[0].kind,'task.cancelled');assert.equal(detail.events[0].reason,'需求已经合并到其他工作');
});

test('referral creates an unowned audit task and explicit membership creates onboarding on the same archive',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web'),archive=await archives.create({type:'person',name:'虚构流程对象',status:'个人接触',request_id:uuid()});const service=new WorkTasks(f.env,f.actor,'mcp');
 const referral=await service.refer({archive_id:archive.id,expected_version:archive.version,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});assert.equal(referral.archive_status,'人事审核');assert.equal(f.sqlite.prepare("SELECT owner_id FROM work_tasks WHERE id=?").get(referral.task_id).owner_id,null);
 const claimed=await service.claim({id:referral.task_id,expected_version:1,request_id:uuid()});await service.complete({id:referral.task_id,expected_version:claimed.version,result_kind:'continue',result_text:'对方愿意继续了解组织。',request_id:uuid()});
 const membership=await service.confirmMembership({archive_id:archive.id,expected_version:2,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});assert.equal(membership.archive_status,'已加入待对接');
 const current=await archives.get(archive.id);assert.equal(current.status,'已加入待对接');assert.equal(current.closed,false);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_tasks WHERE archive_id=? AND kind='onboarding' AND status='open'").get(archive.id).n,1);
 const membershipEvent=f.sqlite.prepare("SELECT before_json,after_json FROM archive_events WHERE archive_id=? AND kind='archive.membership_confirmed'").get(archive.id);assert.equal(JSON.parse(membershipEvent.before_json).audit_task_id,referral.task_id);assert.equal(JSON.parse(membershipEvent.after_json).task_id,membership.task_id);
 assert.equal((await archives.list({type:'person',status:'已加入待对接,已入伙'})).archives.some(item=>item.id===archive.id),true);
 assert.equal((await archives.list({type:'person',person_scope:'members'})).archives.some(item=>item.id===archive.id),true);
 assert.equal((await archives.list({type:'person',person_scope:'external'})).archives.some(item=>item.id===archive.id),false);
 await assert.rejects(service.refer({archive_id:archive.id,expected_version:current.version,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()}),{code:'INVALID_REFERRAL_STAGE'});
});

test('withdrawing an audit cancels only open rule audit tasks atomically, preserving ownership, history and request replay',async t=>{
 const f=fixture();t.after(f.close);const web=new Archives(f.env,f.actor,'web'),mcp=new Archives(f.env,f.actor,'mcp'),tasks=new WorkTasks(f.env,f.actor,'mcp');
 for(const [index,status] of ['视奸观察','个人接触','外部社友','已弃用'].entries()){
  const archive=await web.create({type:'person',name:'虚构审核撤回 '+index,request_id:uuid()});
  const referred=await tasks.refer({archive_id:archive.id,expected_version:1,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
  if(index%2)await tasks.claim({id:referred.task_id,expected_version:1,request_id:uuid()});
  const manual=await tasks.create({archive_id:archive.id,kind:'audit',title:'虚构独立任务',purpose:'独立目的',delivery:'独立交付',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
  const input={id:archive.id,expected_version:2,status,member_ids:[],request_id:uuid()},service=index%2?mcp:web;
  const result=await service.setState(input),detail=await tasks.detail(referred.task_id);
  assert.equal(result.status,status);assert.equal(detail.task.status,'cancelled');assert.equal(detail.task.owner_id,index%2?f.actor.id:null);
  assert.equal(detail.events[0].kind,'task.cancelled');assert.equal(detail.events[0].source,index%2?'mcp':'web');assert.equal(detail.events[0].actor_id,f.actor.id);assert.match(detail.events[0].reason,/撤回人事审核/);
  assert.equal((await tasks.detail(manual.id)).task.status,'open');
  const count=detail.events.length;assert.equal((await service.setState(input)).replayed,true);assert.equal((await tasks.detail(referred.task_id)).events.length,count);
  if(status!=='已弃用')assert.equal((await service.setState({...input,expected_version:result.version,request_id:uuid()})).changed,false);
  assert.equal((await tasks.detail(referred.task_id)).events.length,count);
  if(status==='个人接触'){
   await tasks.cancel({id:manual.id,expected_version:1,reason:'虚构独立任务结束',request_id:uuid()});
   const again=await tasks.refer({archive_id:archive.id,expected_version:result.version,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});assert.notEqual(again.task_id,referred.task_id);assert.equal(again.archive_status,'人事审核');
  }
 }
});

test('audit withdrawal failure rolls back the archive, tasks, history and receipt, while completed audits remain completed',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'mcp');
 const archive=await archives.create({type:'person',name:'虚构撤回事务',request_id:uuid()}),referral=await tasks.refer({archive_id:archive.id,expected_version:1,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 const input={id:archive.id,expected_version:2,status:'个人接触',member_ids:[],request_id:uuid()};
 f.sqlite.exec("CREATE TRIGGER reject_audit_cancel BEFORE UPDATE ON work_tasks WHEN NEW.status='cancelled' BEGIN SELECT RAISE(ABORT,'injected cancellation failure'); END");
 await assert.rejects(archives.setState(input),/injected cancellation failure/);
 assert.equal((await archives.get(archive.id)).status,'人事审核');assert.equal((await archives.get(archive.id)).version,2);assert.equal((await tasks.detail(referral.task_id)).task.status,'open');
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_task_events WHERE kind='task.cancelled'").get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM commands WHERE request_id=?').get(input.request_id).n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mutation_guards').get().n,0);
 f.sqlite.exec('DROP TRIGGER reject_audit_cancel');
 const claimed=await tasks.claim({id:referral.task_id,expected_version:1,request_id:uuid()});await tasks.complete({id:referral.task_id,expected_version:claimed.version,result_kind:'continue',result_text:'虚构审核结果已完成',request_id:uuid()});
 assert.equal((await archives.setState(input)).status,'个人接触');assert.equal((await tasks.detail(referral.task_id)).task.status,'completed');assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_task_events WHERE kind='task.cancelled'").get().n,0);
});

test('cancelling the current automatic audit restores its recorded external relationship and associations through web and MCP',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web');
 for(const [index,status] of ['视奸观察','个人接触','外部社友'].entries()){
  const tasks=new WorkTasks(f.env,f.actor,index%2?'web':'mcp'),a=await archives.create({type:'person',name:'虚构任务取消退回 '+index,status,member_ids:[f.actor.id],request_id:uuid()});
  const referral=await tasks.refer({archive_id:a.id,expected_version:1,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()}),input={id:referral.task_id,expected_version:1,reason:'暂时只保留接触与合作',request_id:uuid()};
  const cancelled=await tasks.cancel(input),current=await archives.get(a.id);
  assert.equal(cancelled.archive_status,status);assert.equal(current.status,status);assert.equal(current.version,3);assert.equal(current.members[0].id,f.actor.id);
  assert.equal((await tasks.detail(referral.task_id)).events.filter(e=>e.kind==='task.cancelled').length,1);assert.equal((await tasks.cancel(input)).replayed,true);assert.equal((await archives.get(a.id)).version,3);
  const newReferral=await tasks.refer({archive_id:a.id,expected_version:3,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});assert.notEqual(newReferral.task_id,referral.task_id);
 }
 // Cancellation cannot undo a later explicit membership or invent a missing origin.
 const tasks=new WorkTasks(f.env,f.actor,'mcp'),a=await archives.create({type:'person',name:'虚构身份变化保护',request_id:uuid()}),referral=await tasks.refer({archive_id:a.id,expected_version:1,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 await archives.setState({id:a.id,expected_version:2,status:'已入伙',member_ids:[],request_id:uuid()});await tasks.cancel({id:referral.task_id,expected_version:1,reason:'旧审核结束',request_id:uuid()});assert.equal((await archives.get(a.id)).status,'已入伙');
 const unknown=await archives.create({type:'person',name:'虚构未知审核来源',status:'人事审核',member_ids:[f.actor.id],request_id:uuid()}),task=await tasks.create({archive_id:unknown.id,kind:'audit',source:'rule',title:'虚构没有引荐历史的任务',purpose:'核对',delivery:'记录',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 await tasks.cancel({id:task.id,expected_version:1,reason:'取消不推定原关系',request_id:uuid()});assert.equal((await archives.get(unknown.id)).status,'人事审核');
});

test('cancelling an audit and restoring the archive rolls back together on SQL failure or concurrent archive edits',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'mcp'),a=await archives.create({type:'person',name:'虚构取消原子边界',status:'个人接触',request_id:uuid()}),referral=await tasks.refer({archive_id:a.id,expected_version:1,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()}),input={id:referral.task_id,expected_version:1,reason:'撤回本次引荐',request_id:uuid()};
 f.sqlite.exec("CREATE TRIGGER reject_audit_restoration BEFORE INSERT ON archive_events WHEN NEW.kind='archive.state_changed' AND json_extract(NEW.after_json,'$.status')='个人接触' BEGIN SELECT RAISE(ABORT,'injected restoration failure'); END");
 await assert.rejects(tasks.cancel(input),/injected restoration failure/);assert.equal((await tasks.detail(referral.task_id)).task.status,'open');assert.equal((await archives.get(a.id)).version,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM commands WHERE request_id=?').get(input.request_id).n,0);
 f.sqlite.exec('DROP TRIGGER reject_audit_restoration');
 const realBatch=f.env.DB.batch;let interfere=true;f.env.DB.batch=async statements=>{if(interfere){interfere=false;await archives.update({id:a.id,expected_version:2,name:'虚构并发资料更新',contacts:[],links:[],request_id:uuid()});}return realBatch(statements);};
 await assert.rejects(tasks.cancel(input),{code:'PRECONDITION_CHANGED'});assert.equal((await tasks.detail(referral.task_id)).task.status,'open');assert.equal((await archives.get(a.id)).status,'人事审核');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mutation_guards').get().n,0);
 assert.equal((await tasks.cancel(input)).archive_status,'个人接触');assert.equal((await archives.get(a.id)).version,4);
});
