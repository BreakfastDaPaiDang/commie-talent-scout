import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {legacyMonthlyTask} from './legacy-monthly-fixture.mjs';
import {workTaskToolNames} from '../app/server/mcp-work-tasks.ts';

const STATES={member:'已入伙',external:'外部社友',personal:'个人接触',org:'组织交流',closed:'已弃用'};
const deadline='2099-12-31T00:00:00.000Z';

function makeAdmin(f){
 f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);
 f.actor.role='admin';
 return f;
}

async function archive(service,type,name,status,memberIds=[]){
 return service.create({type,name,status,member_ids:memberIds,request_id:uuid()});
}

test('old monthly generation is removed; historical tasks still support explicit delivery',async t=>{
 const f=makeAdmin(fixture());t.after(f.close);
 const archives=new Archives(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'web'),observations=new Observations(f.env,f.actor,'web');
 const a=await archive(archives,'person','历史月度任务',STATES.member);
 const task=legacyMonthlyTask(f,a.id);
 assert.equal(typeof tasks.generateMonthly,'undefined');
 assert.equal(typeof tasks.previewMonthly,'undefined');
 assert.equal(typeof tasks.generateScheduledMonthly,'undefined');
 assert.equal(workTaskToolNames.some(name=>name.includes('monthly')),false);
 await assert.rejects(tasks.create({kind:'monthly',archive_id:a.id,period_key:'2099-01',title:'旧入口',purpose:'不再生成',delivery:'留档',deadline_at:deadline,request_id:uuid()}),{code:'MONTHLY_GENERATION_REMOVED'});
 const claimed=await tasks.claim({id:task.id,expected_version:task.version,request_id:uuid()});
 const observation=await observations.create({archive_id:a.id,body:'真实沟通记录',request_id:uuid()});
 await observations.update({id:observation.id,expected_version:1,body:'补充沟通结果',occurred_at:null,request_id:uuid()});
 assert.equal((await tasks.detail(task.id)).task.status,'open');
 await assert.rejects(observations.create({archive_id:a.id,body:'旧自动完成参数',work_task_id:task.id,request_id:uuid()}));
 const edited=await tasks.edit({id:task.id,expected_version:claimed.version,deadline_at:'2099-12-30T00:00:00.000Z',request_id:uuid()});
 const completed=await tasks.complete({id:task.id,expected_version:edited.version,result_kind:'completed',result_text:'已留档',references:[{observation_id:observation.id,content_version:2}],request_id:uuid()});
 assert.equal(completed.status,'completed');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,1);
});

test('membership changes cancel only inapplicable automatic tasks, notify owned cooperation, and do not reopen history',async t=>{
 const f=makeAdmin(fixture());t.after(f.close);
 const archives=new Archives(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'web');
 const member=await archive(archives,'person','身份变化对象',STATES.member,[f.actor.id]);
 const monthly=legacyMonthlyTask(f,member.id);
 assert.ok(monthly);
 const onboarding=await tasks.create({archive_id:member.id,kind:'onboarding',source:'rule',title:'入社对接',purpose:'完成对接',delivery:'留下结果',deadline_at:deadline,request_id:uuid()});
 const cooperation=await tasks.create({archive_id:member.id,kind:'cooperation',title:'合作事项',purpose:'继续确认合作',delivery:'留下合作结果',deadline_at:deadline,request_id:uuid()});
 await tasks.claim({id:cooperation.id,expected_version:cooperation.version,request_id:uuid()});
 const changed=await archives.setState({id:member.id,expected_version:member.version,status:STATES.external,membership_action:'to_friend',member_ids:[],request_id:uuid()});
 assert.equal(changed.status,STATES.external);
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(monthly.id).status,'cancelled');
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(onboarding.id).status,'cancelled');
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(cooperation.id).status,'open');
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_task_events WHERE task_id=? AND kind='task.archive_status_changed'").get(cooperation.id).n,1);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM messages WHERE task_id=? AND kind='archive_status_changed'").get(cooperation.id).n,1);

 const returned=await archives.setState({id:member.id,expected_version:changed.version,status:STATES.member,member_ids:[f.actor.id],request_id:uuid()});
 assert.equal(returned.status,STATES.member);
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(monthly.id).status,'cancelled');
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(onboarding.id).status,'cancelled');
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM messages WHERE task_id=? AND kind='archive_status_changed'").get(cooperation.id).n,1);
});

test('closing, reopening, and deleting an archive preserve cancellation history and manual cooperation',async t=>{
 const f=makeAdmin(fixture());t.after(f.close);
 const archives=new Archives(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'mcp');
 const closed=await archive(archives,'person','关闭对象',STATES.member,[f.actor.id]);
 const monthly=legacyMonthlyTask(f,closed.id);
 const audit=await tasks.create({archive_id:closed.id,kind:'audit',source:'rule',title:'遗留审核',purpose:'检查',delivery:'记录',deadline_at:deadline,request_id:uuid()});
 const onboarding=await tasks.create({archive_id:closed.id,kind:'onboarding',source:'rule',title:'遗留对接',purpose:'对接',delivery:'记录',deadline_at:deadline,request_id:uuid()});
 const cooperation=await tasks.create({archive_id:closed.id,kind:'cooperation',title:'保留合作',purpose:'继续合作',delivery:'记录',deadline_at:deadline,request_id:uuid()});
 const closedResult=await archives.setState({id:closed.id,expected_version:closed.version,status:STATES.closed,membership_action:'leave',member_ids:[],request_id:uuid()});
 for(const task of [monthly,audit,onboarding])assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(task.id).status,'cancelled',task.kind);
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(cooperation.id).status,'open');
 await assert.rejects(tasks.reopen({id:monthly.id,expected_version:2,deadline_at:deadline,owner_mode:'unassigned',request_id:uuid()}),{code:'ARCHIVE_CLOSED'});
 const reopened=await archives.reopen({id:closed.id,expected_version:closedResult.version,status:STATES.member,member_ids:[f.actor.id],request_id:uuid()});
 assert.equal(reopened.status,STATES.member);
 for(const task of [monthly,audit,onboarding])assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(task.id).status,'cancelled',task.kind);

 const deleted=await archive(archives,'person','删除对象',STATES.member,[f.actor.id]);
 const deletedMonthly=legacyMonthlyTask(f,deleted.id,'2099-02');
 const deletedManual=await tasks.create({archive_id:deleted.id,kind:'cooperation',title:'删除后保留',purpose:'保留历史合作',delivery:'记录',deadline_at:deadline,request_id:uuid()});
 await archives.setDeleted({id:deleted.id,expected_version:deleted.version,request_id:uuid()},true);
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(deletedMonthly.id).status,'cancelled');
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(deletedManual.id).status,'open');
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_task_events WHERE task_id=? AND kind='task.cancelled'").get(deletedMonthly.id).n,1);
});
