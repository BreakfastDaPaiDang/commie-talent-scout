import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';

function addMember(f,name){
 const id=uuid(),credential=uuid(),at=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,qq,created_at) VALUES(?,?,?,'member','fixture',0,'00000',?)")
   .run(id,`fixture-${name}-${id}`,name,at);
 f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'mcp','fixture',1,?,'2099-01-01T00:00:00.000Z')")
   .run(credential,id,uuid(),at);
 return {...f.sqlite.prepare('SELECT * FROM members WHERE id=?').get(id),credential_id:credential,credential_kind:'mcp'};
}

function taskInput(request_id=uuid()){
 return {kind:'custom',title:'跨入口任务',purpose:'验证网页与 MCP 共享任务数据',delivery:'留下可回查的工作结果',deadline_at:'2099-01-01T00:00:00.000Z',request_id};
}

test('work task creation is separate from MCP review tasks and can be claimed once',async t=>{
 const f=fixture();t.after(f.close);const service=new WorkTasks(f.env,f.actor,'mcp');
 const created=await service.create({kind:'audit',title:'人事审核',purpose:'了解是否适合继续接触',delivery:'提交观察与结论',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 assert.equal(created.status,'open');assert.equal(created.owner_id,null);
 const listed=await service.list({scope:'all'});assert.equal(listed.tasks.length,1);
 const claimed=await service.claim({id:created.id,expected_version:created.version,request_id:uuid()});assert.equal(claimed.owner_id,f.actor.id);
 await assert.rejects(service.claim({id:created.id,expected_version:created.version,request_id:uuid()}),error=>error.code==='TASK_ALREADY_CLAIMED'&&/已被其他成员领取/.test(error.message));
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
 const event=f.sqlite.prepare("SELECT kind,reason FROM work_task_events WHERE task_id=? ORDER BY rowid DESC LIMIT 1").get(task.id);assert.equal(event.kind,'task.assigned');assert.equal(event.reason,'本周负责入社对接');
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

test('two members racing the same claim leave one owner, an explicit transaction rejection, and no duplicate retry event',async t=>{
 const f=fixture();t.after(f.close);
 const other=addMember(f,'并发领取成员'),creator=new WorkTasks(f.env,f.actor,'web'),first=new WorkTasks(f.env,f.actor,'mcp'),second=new WorkTasks(f.env,other,'mcp');
 const task=await creator.create(taskInput());
 const realBatch=f.env.DB.batch;let waiting;
 // Let both callers finish their version-1 reads, then commit the two prepared
 // batches serially. The second batch must fail its transaction guard.
 f.env.DB.batch=async statements=>{
  if(!waiting)return new Promise((resolve,reject)=>{waiting={statements,resolve,reject};});
  const first=waiting;waiting=undefined;
  try{
   const firstResult=await realBatch(first.statements);first.resolve(firstResult);
   return await realBatch(statements);
  }catch(error){first.reject(error);throw error;}
 };
 const requestIds=[uuid(),uuid()];let results;
 try{
  results=await Promise.allSettled([
   first.claim({id:task.id,expected_version:1,request_id:requestIds[0]}),
   second.claim({id:task.id,expected_version:1,request_id:requestIds[1]}),
  ]);
 }finally{f.env.DB.batch=realBatch;}
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const rejected=results.find(r=>r.status==='rejected');
 assert.equal(rejected?.reason.code,'TASK_ALREADY_CLAIMED');
 assert.match(rejected?.reason.message??'',/已被其他成员领取/);
 const current=f.sqlite.prepare('SELECT owner_id,version FROM work_tasks WHERE id=?').get(task.id);
 assert.equal(current.version,2);assert.ok([f.actor.id,other.id].includes(current.owner_id));
 const winnerIndex= current.owner_id===f.actor.id?0:1;
 const winningActor=current.owner_id===f.actor.id?f.actor:other;
 const retry=await new WorkTasks(f.env,winningActor,'mcp').claim({id:task.id,expected_version:1,request_id:requestIds[winnerIndex]});
 assert.equal(retry.replayed,true);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_task_events WHERE task_id=? AND kind='task.claimed'").get(task.id).n,1);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mutation_guards').get().n,0);
});

test('web and MCP share task state and enforce owner permissions across the full operation path',async t=>{
 const f=fixture();t.after(f.close);
 const other=addMember(f,'跨入口成员'),web=new WorkTasks(f.env,f.actor,'web'),mcp=new WorkTasks(f.env,other,'mcp');
 const webCreated=await web.create(taskInput());
 const fromMcp=await mcp.list({scope:'all'});
 assert.equal(fromMcp.tasks.find(task=>task.id===webCreated.id)?.owner_id,null);
 const claimed=await mcp.claim({id:webCreated.id,expected_version:webCreated.version,request_id:uuid()});
 const fromWeb=await web.detail(webCreated.id);
 assert.equal(fromWeb.task.owner_id,other.id);
 await assert.rejects(web.complete({id:webCreated.id,expected_version:claimed.version,result_kind:'completed',result_text:'越权完成不应成功',request_id:uuid()}),{code:'TASK_OWNER_REQUIRED'});
 await assert.rejects(web.cancel({id:webCreated.id,expected_version:claimed.version,reason:'越权取消不应成功',request_id:uuid()}),{code:'TASK_CANCEL_FORBIDDEN'});
 const completed=await mcp.complete({id:webCreated.id,expected_version:claimed.version,result_kind:'unable_to_contact',result_text:'跨入口完成：本次未联系到对象。',request_id:uuid()});
 assert.equal((await web.detail(webCreated.id)).task.status,'completed');
 assert.equal(completed.version,3);

 const mcpCreated=await mcp.create(taskInput());
 assert.ok((await web.list({scope:'all'})).tasks.some(task=>task.id===mcpCreated.id));
 const webClaim=await web.claim({id:mcpCreated.id,expected_version:mcpCreated.version,request_id:uuid()});
 assert.equal((await mcp.detail(mcpCreated.id)).task.owner_id,f.actor.id);
 const released=await web.release({id:mcpCreated.id,expected_version:webClaim.version,deadline_at:'2099-02-01T00:00:00.000Z',request_id:uuid()});
 assert.equal((await mcp.detail(mcpCreated.id)).task.owner_id,null);
 const cancelled=await mcp.cancel({id:mcpCreated.id,expected_version:released.version,reason:'跨入口取消：已合并到其他工作',request_id:uuid()});
 assert.equal(cancelled.status,'cancelled');
 const events=(await web.detail(mcpCreated.id)).events;
 assert.deepEqual(events.map(event=>event.kind),['task.cancelled','task.released','task.claimed','task.created']);
 assert.deepEqual(events.map(event=>event.source),['mcp','web','web','mcp']);
});

test('stale versions and frozen accounts cannot mutate an owned task',async t=>{
 const f=fixture();t.after(f.close);
 const other=addMember(f,'边界成员'),web=new WorkTasks(f.env,f.actor,'web'),mcp=new WorkTasks(f.env,other,'mcp');
 const task=await web.create(taskInput());
 const claimed=await mcp.claim({id:task.id,expected_version:task.version,request_id:uuid()});
 await assert.rejects(web.claim({id:task.id,expected_version:task.version,request_id:uuid()}),error=>error.code==='TASK_ALREADY_CLAIMED'&&/已被其他成员领取/.test(error.message));
 await assert.rejects(web.complete({id:task.id,expected_version:claimed.version,result_kind:'completed',result_text:'非负责人不能完成',request_id:uuid()}),{code:'TASK_OWNER_REQUIRED'});
 f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(other.id);
 await assert.rejects(mcp.complete({id:task.id,expected_version:claimed.version,result_kind:'completed',result_text:'冻结账号不能完成',request_id:uuid()}),{code:'PRECONDITION_CHANGED'});
 const current=await web.detail(task.id);
 assert.equal(current.task.status,'open');assert.equal(current.task.owner_id,other.id);assert.equal(current.events.length,2);
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

test('task history supports content edits, deadline extension, comments with permission-filtered references, and recovery',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web');
 const archive=await archives.create({type:'person',name:'评论引用档案',request_id:uuid()});
 const observation=uuid(),at=new Date().toISOString();
 f.sqlite.prepare('INSERT INTO observations(id,archive_id,author_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(observation,archive.id,f.actor.id,at,at);
 f.sqlite.prepare('INSERT INTO observation_versions(observation_id,version,body,editor_id,created_at) VALUES(?,?,?,?,?)').run(observation,1,'正文只应在观察接口返回',f.actor.id,at);
 const service=new WorkTasks(f.env,f.actor,'web'),task=await service.create({archive_id:archive.id,kind:'custom',title:'原始标题',purpose:'原始目的',delivery:'原始交付',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 const edited=await service.edit({id:task.id,expected_version:1,title:'更新标题',request_id:uuid()});assert.equal(edited.version,2);
 const claimed=await service.claim({id:task.id,expected_version:edited.version,request_id:uuid()});
 const extended=await service.extend({id:task.id,expected_version:claimed.version,deadline_at:'2099-02-01T00:00:00.000Z',reason:'补充核对时间',request_id:uuid()});assert.equal(extended.version,4);
 const comment=await service.addComment({task_id:task.id,body:'已完成第一轮核对',references:[{observation_id:observation,content_version:1}],request_id:uuid()});
 let detail=await service.detail(task.id);assert.equal(detail.comments[0].body,'已完成第一轮核对');assert.deepEqual(detail.comments[0].references,[{observation_id:observation,archive_id:archive.id,content_version:1}]);assert.equal(detail.task.deadline_at,'2099-02-01T00:00:00.000Z');
 const editedComment=await service.editComment({id:comment.id,expected_version:comment.version,body:'已完成第二轮核对，等待复核',request_id:uuid()});assert.equal(editedComment.version,2);detail=await service.detail(task.id);assert.equal(detail.comments[0].body,'已完成第二轮核对，等待复核');assert.deepEqual(detail.comments[0].history.map(version=>version.body),['已完成第一轮核对','已完成第二轮核对，等待复核']);
 f.sqlite.prepare('UPDATE observations SET deleted=1,deleted_at=? WHERE id=?').run(at,observation);
 const other=addMember(f,'评论读取成员');detail=await new WorkTasks(f.env,other,'mcp').detail(task.id);assert.deepEqual(detail.comments[0].references,[]);assert.equal(detail.comments[0].references_restricted,true);
 const deleted=await service.deleteComment({id:comment.id,expected_version:editedComment.version,request_id:uuid()});assert.equal(deleted.deleted,true);const restored=await service.restoreComment({id:comment.id,expected_version:deleted.version,request_id:uuid()});assert.equal(restored.deleted,false);
  const resultObservation=uuid();f.sqlite.prepare('INSERT INTO observations(id,archive_id,author_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(resultObservation,archive.id,f.actor.id,at,at);f.sqlite.prepare('INSERT INTO observation_versions(observation_id,version,body,editor_id,created_at) VALUES(?,?,?,?,?)').run(resultObservation,1,'result observation',f.actor.id,at);const completed=await service.complete({id:task.id,expected_version:extended.version,result_kind:'unable_to_contact',result_text:'follow up',references:[{observation_id:resultObservation,content_version:1}],request_id:uuid()});assert.equal(completed.status,'completed');await new Observations(f.env,f.actor,'web').update({id:resultObservation,expected_version:1,body:'result observation newer',occurred_at:null,request_id:uuid()});assert.equal((await new Observations(f.env,f.actor,'web').detail(resultObservation,1)).observation.body,'result observation');assert.equal((await new Observations(f.env,f.actor,'web').detail(resultObservation)).observation.body,'result observation newer');const completedDetail=await service.detail(task.id);assert.deepEqual(completedDetail.task.result_references,[{observation_id:resultObservation,archive_id:archive.id,content_version:1}]);
 await assert.rejects(service.addComment({task_id:task.id,body:'关闭后不能追加',request_id:uuid()}),{code:'TASK_NOT_OPEN'});
 assert.equal((await service.list({state:'closed'})).tasks.some(row=>row.id===task.id),true);
  assert.deepEqual((await service.detail(task.id)).events.map(event=>event.kind),['task.completed','task.comment_restored','task.comment_deleted','task.comment_updated','task.comment_created','task.deadline_changed','task.claimed','task.edited','task.created']);
 });

 test('administrators can edit another member comment while preserving the version stream',async t=>{
  const f=fixture();t.after(f.close);const owner=new WorkTasks(f.env,f.actor,'web'),task=await owner.create(taskInput()),other=addMember(f,'他人评论作者'),writer=new WorkTasks(f.env,other,'mcp');
  const comment=await writer.addComment({task_id:task.id,body:'成员原始评论',request_id:uuid()});
  f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';
  const edited=await owner.editComment({id:comment.id,expected_version:comment.version,body:'管理员修订评论',request_id:uuid()});assert.equal(edited.version,2);
  const detail=await owner.detail(task.id);assert.equal(detail.comments[0].body,'管理员修订评论');assert.deepEqual(detail.comments[0].history.map(version=>version.body),['成员原始评论','管理员修订评论']);
 });

 test('expiry and reopen preserve the prior closure result while respecting owner and admin modes',async t=>{
 const f=fixture();t.after(f.close);const service=new WorkTasks(f.env,f.actor,'web');
 const task=await service.create(taskInput());const claimed=await service.claim({id:task.id,expected_version:task.version,request_id:uuid()});
 const expired=await service.expire('2099-02-01T00:00:00.000Z');assert.equal(expired.count,1);assert.equal((await service.detail(task.id)).task.status,'expired');
 const reopened=await service.reopen({id:task.id,expected_version:claimed.version+1,deadline_at:'2099-03-01T00:00:00.000Z',owner_mode:'keep',request_id:uuid()});assert.equal(reopened.owner_id,f.actor.id);assert.equal(reopened.status,'open');
 const completed=await service.complete({id:task.id,expected_version:reopened.version,result_kind:'completed',result_text:'重开后完成',request_id:uuid()});assert.equal(completed.status,'completed');
 const detail=await service.detail(task.id);assert.deepEqual(detail.events.map(event=>event.kind),['task.completed','task.reopened','task.expired','task.claimed','task.created']);
 const second=await service.create(taskInput());const secondClaim=await service.claim({id:second.id,expected_version:1,request_id:uuid()});await service.expire('2099-02-01T00:00:00.000Z');
 f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';
 const unassigned=await service.reopen({id:second.id,expected_version:secondClaim.version+1,deadline_at:'2099-03-01T00:00:00.000Z',owner_mode:'unassigned',request_id:uuid()});assert.equal(unassigned.owner_id,null);
 await assert.rejects(service.reopen({id:task.id,expected_version:completed.version,deadline_at:'2099-04-01T00:00:00.000Z',owner_mode:'unassigned',request_id:uuid()}),{code:'TASK_NOT_REOPENABLE'});
});
