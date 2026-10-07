import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {monthDeadline} from '../app/shared/monthly-tasks.ts';

const STATES={member:'已入伙',external:'外部社友',personal:'个人接触',org:'组织交流',closed:'已弃用'};
const deadline='2099-12-31T00:00:00.000Z';
const january='2099-01-15T12:00:00.000Z';

function makeAdmin(f){
 f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);
 f.actor.role='admin';
 return f;
}

async function archive(service,type,name,status,memberIds=[]){
 return service.create({type,name,status,member_ids:memberIds,request_id:uuid()});
}

test('scheduled monthly generation stays disabled until explicitly enabled, then replay keeps one task',async t=>{
 const f=makeAdmin(fixture());t.after(f.close);
 f.env.ENVIRONMENT='production';
 await archive(new Archives(f.env,f.actor,'web'),'person','首批任务待核对',STATES.personal);
 const tasks=new WorkTasks(f.env,f.actor,'mcp');
 assert.equal(await tasks.generateScheduledMonthly(),null);
 f.env.MONTHLY_TASKS_ENABLED='false';
 assert.equal(await tasks.generateScheduledMonthly(),null);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,0);
 f.env.MONTHLY_TASKS_ENABLED='true';
 assert.equal((await tasks.generateScheduledMonthly()).created_count,1);
 assert.equal((await tasks.generateScheduledMonthly()).created_count,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,1);
});

test('monthly generation covers people and organizations, is idempotent, and auto-completes from linked observations',async t=>{
 const f=makeAdmin(fixture());t.after(f.close);
 const archives=new Archives(f.env,f.actor,'web');
 const member=await archive(archives,'person','月度社员',STATES.member,[f.actor.id]);
 const external=await archive(archives,'person','月度外部对象',STATES.personal);
 const ambassador=uuid(),ambassadorAt=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,qq,created_at) VALUES(?,?,?,'member','fixture',0,'00000',?)").run(ambassador,'ambassador', '组织大使',ambassadorAt);
 const organization=await archive(archives,'org','月度组织',STATES.org,[f.actor.id,ambassador]);
 assert.equal((await archives.get(organization.id)).members.length,2);
 const tasks=new WorkTasks(f.env,f.actor,'mcp');
 const preview=await tasks.previewMonthly({month:'2099-01'});
 assert.equal(preview.deadline_at,monthDeadline('2099-01'));
 assert.deepEqual(preview.archives.map(item=>item.id).sort(),[member.id,external.id,organization.id].sort());
 const generated=await tasks.generateMonthly({month:'2099-01',request_id:uuid()});
 assert.equal(generated.eligible_count,3);
 assert.equal(generated.created_count,3);
 assert.equal(generated.changed,true);
 assert.equal(generated.tasks.length,3);
 assert.ok(generated.tasks.every(task=>task.period_key==='2099-01'&&task.deadline_at===monthDeadline('2099-01')));
 const repeated=await tasks.generateMonthly({month:'2099-01',request_id:uuid()});
 assert.equal(repeated.created_count,0);
 assert.equal(repeated.changed,false);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_tasks WHERE kind='monthly' AND period_key='2099-01'").get().n,3);
 const nextMonth=await tasks.generateMonthly({month:'2099-02',request_id:uuid()});
 assert.equal(nextMonth.created_count,3);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_tasks WHERE kind='monthly'").get().n,6);

 const memberTask=generated.tasks.find(task=>task.archive_id===member.id);
 assert.ok(memberTask);
 const claimed=await tasks.claim({id:memberTask.id,expected_version:memberTask.version,request_id:uuid()});
 const observations=new Observations(f.env,f.actor,'web');
 const created=await observations.create({archive_id:member.id,body:'记录本月联系结果',occurred_at:january,work_task_id:memberTask.id,request_id:uuid()});
 const completed=f.sqlite.prepare('SELECT status,result_kind,result_references_json,version FROM work_tasks WHERE id=?').get(memberTask.id);
 assert.equal(completed.status,'completed');
 assert.equal(completed.result_kind,'completed');
 assert.equal(completed.version,claimed.version+1);
 assert.deepEqual(JSON.parse(completed.result_references_json),[{observation_id:created.id,content_version:1}]);

 const externalTask=generated.tasks.find(task=>task.archive_id===external.id);
 assert.ok(externalTask);
 await tasks.claim({id:externalTask.id,expected_version:externalTask.version,request_id:uuid()});
 await assert.rejects(observations.create({archive_id:external.id,body:'月份不匹配',occurred_at:'2099-02-15T12:00:00.000Z',work_task_id:externalTask.id,request_id:uuid()}),{code:'TASK_PERIOD_MISMATCH'});
 await observations.create({archive_id:external.id,body:'普通观察不自动关闭任务',occurred_at:january,request_id:uuid()});
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(externalTask.id).status,'open');

 const organizationTask=generated.tasks.find(task=>task.archive_id===organization.id);
 assert.ok(organizationTask);
 const organizationClaim=await tasks.claim({id:organizationTask.id,expected_version:organizationTask.version,request_id:uuid()});
 const ordinaryObservation=await observations.create({archive_id:organization.id,body:'先记录普通观察',occurred_at:january,request_id:uuid()});
 const updated=await observations.update({id:ordinaryObservation.id,expected_version:1,body:'补充为本月跟进结果',occurred_at:january,work_task_id:organizationTask.id,request_id:uuid()});
 assert.equal(updated.content_version,2);
 assert.equal(f.sqlite.prepare('SELECT status,version FROM work_tasks WHERE id=?').get(organizationTask.id).status,'completed');
 assert.equal(f.sqlite.prepare('SELECT version FROM work_tasks WHERE id=?').get(organizationTask.id).version,organizationClaim.version+1);

 const febTask=nextMonth.tasks.find(task=>task.archive_id===organization.id);
 assert.ok(febTask);
 const febClaim=await tasks.claim({id:febTask.id,expected_version:febTask.version,request_id:uuid()});
 const noContact=await tasks.complete({id:febTask.id,expected_version:febClaim.version,result_kind:'unable_to_contact',result_text:'本月未联系到，保留后续跟进',request_id:uuid()});
 assert.equal(noContact.result_kind,'unable_to_contact');
});

test('membership changes cancel only inapplicable automatic tasks, notify owned cooperation, and do not reopen history',async t=>{
 const f=makeAdmin(fixture());t.after(f.close);
 const archives=new Archives(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'web');
 const member=await archive(archives,'person','身份变化对象',STATES.member,[f.actor.id]);
 const monthly=(await tasks.generateMonthly({month:'2099-01',request_id:uuid()})).tasks.find(task=>task.archive_id===member.id);
 assert.ok(monthly);
 const onboarding=await tasks.create({archive_id:member.id,kind:'onboarding',source:'rule',title:'入社对接',purpose:'完成对接',delivery:'留下结果',deadline_at:deadline,request_id:uuid()});
 const cooperation=await tasks.create({archive_id:member.id,kind:'cooperation',title:'合作事项',purpose:'继续确认合作',delivery:'留下合作结果',deadline_at:deadline,request_id:uuid()});
 await tasks.claim({id:cooperation.id,expected_version:cooperation.version,request_id:uuid()});
 const changed=await archives.setState({id:member.id,expected_version:member.version,status:STATES.external,member_ids:[],request_id:uuid()});
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
 const monthly=(await tasks.generateMonthly({month:'2099-01',request_id:uuid()})).tasks.find(task=>task.archive_id===closed.id);
 const audit=await tasks.create({archive_id:closed.id,kind:'audit',source:'rule',title:'遗留审核',purpose:'检查',delivery:'记录',deadline_at:deadline,request_id:uuid()});
 const onboarding=await tasks.create({archive_id:closed.id,kind:'onboarding',source:'rule',title:'遗留对接',purpose:'对接',delivery:'记录',deadline_at:deadline,request_id:uuid()});
 const cooperation=await tasks.create({archive_id:closed.id,kind:'cooperation',title:'保留合作',purpose:'继续合作',delivery:'记录',deadline_at:deadline,request_id:uuid()});
 const closedResult=await archives.setState({id:closed.id,expected_version:closed.version,status:STATES.closed,member_ids:[],request_id:uuid()});
 for(const task of [monthly,audit,onboarding])assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(task.id).status,'cancelled',task.kind);
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(cooperation.id).status,'open');
 await assert.rejects(tasks.reopen({id:monthly.id,expected_version:2,deadline_at:deadline,owner_mode:'unassigned',request_id:uuid()}),{code:'ARCHIVE_CLOSED'});
 const reopened=await archives.reopen({id:closed.id,expected_version:closedResult.version,status:STATES.member,member_ids:[f.actor.id],request_id:uuid()});
 assert.equal(reopened.status,STATES.member);
 for(const task of [monthly,audit,onboarding])assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(task.id).status,'cancelled',task.kind);

 const deleted=await archive(archives,'person','删除对象',STATES.member,[f.actor.id]);
 const deletedMonthly=(await tasks.generateMonthly({month:'2099-02',request_id:uuid()})).tasks.find(task=>task.archive_id===deleted.id);
 const deletedManual=await tasks.create({archive_id:deleted.id,kind:'cooperation',title:'删除后保留',purpose:'保留历史合作',delivery:'记录',deadline_at:deadline,request_id:uuid()});
 await archives.setDeleted({id:deleted.id,expected_version:deleted.version,request_id:uuid()},true);
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(deletedMonthly.id).status,'cancelled');
 assert.equal(f.sqlite.prepare('SELECT status FROM work_tasks WHERE id=?').get(deletedManual.id).status,'open');
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_task_events WHERE task_id=? AND kind='task.cancelled'").get(deletedMonthly.id).n,1);
});
