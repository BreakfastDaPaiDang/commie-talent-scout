import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {fixture} from './d1-fixture.mjs';
import {formalActor,recognizeThree} from './personnel-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {Messages} from '../app/server/messages.ts';
import {PersonnelRecognition,recognitionMonth} from '../app/server/personnel-recognition.ts';
async function target(f){const a=await new Archives(f.env,f.actor,'web').create({type:'person',name:'虚构候选人',request_id:uuid()});const o=await new Observations(f.env,f.actor,'web').create({archive_id:a.id,body:'具体协作经历',request_id:uuid()});return {archive_id:a.id,round_number:1,observation_id:o.id,content_version:1,request_id:uuid()};}
test('Beijing calendar months use local midnight, including year boundary',()=>{assert.equal(recognitionMonth('2026-11-30T15:59:59Z'),'2026-11');assert.equal(recognitionMonth('2026-11-30T16:00:00Z'),'2026-12');assert.equal(recognitionMonth('2026-12-31T16:00:00Z'),'2027-01');});
for(const source of ['web','mcp'])test(`${source}: three distinct formal members create one unclaimed audit atomically and replay safely`,async t=>{
 const f=fixture();t.after(f.close);const a=await target(f);let last;
 for(let i=0;i<3;i++){const actor=formalActor(f),svc=new PersonnelRecognition(f.env,actor,source);last=await svc.recognize({...a,request_id:uuid()});assert.equal(last.count,i+1);assert.equal(last.triggered,i===2);}
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_tasks WHERE archive_id=? AND kind='audit'").get(a.archive_id).n,1);
 const task=f.sqlite.prepare('SELECT * FROM work_tasks WHERE id=?').get(last.task_id);assert.equal(task.owner_id,null);assert.equal(task.status,'open');assert.equal((await new Archives(f.env,f.actor,'web').get(a.archive_id)).status,'人事审核');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mutation_guards').get().n,0);
});
test('eligibility is formal human identity; administrators and service accounts cannot bypass it',async t=>{
 const f=fixture();t.after(f.close);const a=await target(f);
 await assert.rejects(new PersonnelRecognition(f.env,f.actor,'web').recognize(a),{code:'FORMAL_MEMBER_REQUIRED'});
 f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';
 await assert.rejects(new PersonnelRecognition(f.env,f.actor,'web').recognize(a),{code:'FORMAL_MEMBER_REQUIRED'});
 const bot=formalActor(f,{identity_kind:'service'});await assert.rejects(new PersonnelRecognition(f.env,bot,'mcp').recognize(a),{code:'FORMAL_MEMBER_REQUIRED'});
 const admin=formalActor(f,{role:'admin'});assert.equal((await new PersonnelRecognition(f.env,admin,'web').recognize(a)).count,1);
});
test('two monthly slots, duplicate identity, withdrawal and retry never mint extra quota',async t=>{
 const f=fixture();t.after(f.close);const actor=formalActor(f),s=new PersonnelRecognition(f.env,actor,'web'),a=await target(f),b=await target(f),c=await target(f);
 const first=await s.recognize(a);assert.deepEqual(await s.recognize(a),{...first,replayed:true});
 await assert.rejects(s.recognize({...a,request_id:uuid()}),{code:'ALREADY_RECOGNIZED'});
 await s.withdraw({id:first.id,request_id:uuid()});assert.equal((await s.summary({archive_id:a.archive_id})).quota.remaining,1);
 await assert.rejects(s.recognize({...a,request_id:uuid()}),{code:'ALREADY_RECOGNIZED'});
 await s.recognize(b);await assert.rejects(s.recognize(c),{code:'MONTHLY_QUOTA_EXHAUSTED'});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM personnel_recognitions').get().n,2);
});
test('old recognitions survive month changes but account rebinding does not reset the current-month quota',async t=>{
 const f=fixture();t.after(f.close);const actor=formalActor(f),a=await target(f),svc=new PersonnelRecognition(f.env,actor,'web');await svc.recognize(a);
 const newActor=formalActor(f);f.sqlite.prepare('UPDATE archives SET linked_account_id=NULL WHERE id=?').run(newActor.archiveId);f.sqlite.prepare('UPDATE archives SET linked_account_id=? WHERE id=?').run(newActor.id,actor.archiveId);
 const next=new PersonnelRecognition(f.env,newActor,'web');assert.equal((await next.summary({archive_id:a.archive_id})).quota.remaining,1);
 await assert.rejects(next.recognize({...a,request_id:uuid()}),{code:'ALREADY_RECOGNIZED'});
 f.sqlite.prepare("UPDATE personnel_recognitions SET month='2020-01'").run();const s=await next.summary({archive_id:a.archive_id});assert.equal(s.count,1);assert.equal(s.quota.remaining,2);
});
test('recognition pins the read observation version; deleted evidence does not reach threshold',async t=>{
 const f=fixture();t.after(f.close);const a=await target(f),actor=formalActor(f),s=new PersonnelRecognition(f.env,actor,'web');await s.recognize(a);
 const obs=new Observations(f.env,f.actor,'web');await obs.update({id:a.observation_id,expected_version:1,body:'已修订的事实',occurred_at:null,attachment_ids:[],request_id:uuid()});
 assert.equal((await s.summary({archive_id:a.archive_id})).votes[0].content_version,1);
 await assert.rejects(new PersonnelRecognition(f.env,formalActor(f),'web').recognize({...a,request_id:uuid()}),{code:'EVIDENCE_CHANGED'});
 await obs.setDeleted({id:a.observation_id,expected_version:2,request_id:uuid()},true);
 assert.equal((await s.summary({archive_id:a.archive_id})).count,0);
});
test('third vote SQL failure rolls back vote, slot, archive, round, task and receipt',async t=>{
 const f=fixture();t.after(f.close);const a=await target(f);for(let i=0;i<2;i++)await new PersonnelRecognition(f.env,formalActor(f),'web').recognize({...a,request_id:uuid()});
 f.sqlite.exec("CREATE TRIGGER fail_personnel_task BEFORE INSERT ON work_tasks BEGIN SELECT RAISE(ABORT,'fixture task failure'); END");
 const actor=formalActor(f),s=new PersonnelRecognition(f.env,actor,'web');await assert.rejects(s.recognize(a),/fixture task failure/);
 assert.equal((await s.summary({archive_id:a.archive_id})).quota.remaining,2);assert.equal((await s.summary({archive_id:a.archive_id})).count,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM commands WHERE member_id=? AND request_id=?').get(actor.id,a.request_id).n,0);
});
for(const change of ['frozen','binding','evidence','archive'])test(`transaction rechecks ${change} after preparing a vote`,async t=>{
 const f=fixture();t.after(f.close);const a=await target(f),actor=formalActor(f),s=new PersonnelRecognition(f.env,actor,'web'),batch=f.env.DB.batch;
 f.env.DB.batch=async statements=>{if(change==='frozen')f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(actor.id);if(change==='binding')f.sqlite.prepare('UPDATE archives SET linked_account_id=NULL WHERE id=?').run(actor.archiveId);if(change==='evidence')f.sqlite.prepare('UPDATE observations SET deleted=1 WHERE id=?').run(a.observation_id);if(change==='archive')f.sqlite.prepare('UPDATE archives SET version=version+1 WHERE id=?').run(a.archive_id);return batch(statements);};
 await assert.rejects(s.recognize(a),{code:'PRECONDITION_CHANGED'});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM personnel_recognitions').get().n,0);
});
test('all direct entry points reject bypass, including admin and raw old-code state writes',async t=>{
 const f=fixture();t.after(f.close);f.actor.role='admin';f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);const a=await target(f),archives=new Archives(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'mcp');
 for(const status of ['人事审核','已加入待对接','已入伙']){await assert.rejects(archives.create({type:'person',name:'绕过',status,request_id:uuid()}),{code:'PERSONNEL_RECOGNITION_REQUIRED'});await assert.rejects(archives.setState({id:a.archive_id,expected_version:2,status,member_ids:[],request_id:uuid()}),{code:'PERSONNEL_RECOGNITION_REQUIRED'});assert.throws(()=>f.sqlite.prepare('UPDATE archives SET status=? WHERE id=?').run(status,a.archive_id));}
 await assert.rejects(tasks.refer({archive_id:a.archive_id,expected_version:2,deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()}),{code:'PERSONNEL_RECOGNITION_REQUIRED'});
 await assert.rejects(tasks.create({archive_id:a.archive_id,kind:'audit',source:'rule',title:'绕过',purpose:'绕过',delivery:'绕过',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()}),{code:'RULE_TASK_REQUIRED'});
});
test('withdraw after threshold preserves task, notifies owner, and a closed round requires fresh recognitions',async t=>{
 const f=fixture();t.after(f.close);const a=await target(f),actors=[formalActor(f),formalActor(f),formalActor(f)];let result;for(const actor of actors)result=await new PersonnelRecognition(f.env,actor,'web').recognize({...a,request_id:uuid()});
 const tasks=new WorkTasks(f.env,f.actor,'web'),claim=await tasks.claim({id:result.task_id,expected_version:1,request_id:uuid()});
 const vote=f.sqlite.prepare('SELECT id FROM personnel_recognitions WHERE account_id=?').get(actors[0].id);await new PersonnelRecognition(f.env,actors[0],'web').withdraw({id:vote.id,request_id:uuid()});
 assert.equal((await tasks.detail(result.task_id)).task.status,'open');assert.equal(f.sqlite.prepare("SELECT count(*) n FROM messages WHERE kind='personnel_recognition_withdrawn'").get().n,1);
 assert.equal((await new Messages(f.env,f.actor).list()).messages.filter(m=>m.kind==='personnel_recognition_withdrawn').length,1);
 await tasks.cancel({id:result.task_id,expected_version:claim.version,reason:'本轮不继续',request_id:uuid()});
 const s=await new PersonnelRecognition(f.env,actors[1],'web').summary({archive_id:a.archive_id});assert.equal(s.round.state,'closed');assert.equal(s.round_number,2);assert.equal(s.count,0);
 await assert.rejects(new PersonnelRecognition(f.env,actors[1],'web').recognize({...a,request_id:uuid()}),{code:'ROUND_CHANGED'});
 const task=(await tasks.detail(result.task_id)).task;await assert.rejects(tasks.reopen({id:task.id,expected_version:task.version,owner_mode:'keep',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()}),{code:'NEW_RECOGNITION_ROUND_REQUIRED'});
});
test('racing third and fourth recognitions commit exactly one review and never charge the losing request',async t=>{
 const f=fixture();t.after(f.close);const a=await target(f);for(let i=0;i<2;i++)await new PersonnelRecognition(f.env,formalActor(f),'web').recognize({...a,request_id:uuid()});
 const loser=formalActor(f),winner=formalActor(f),batch=f.env.DB.batch;let winning;
 f.env.DB.batch=async statements=>{f.env.DB.batch=batch;winning=await new PersonnelRecognition(f.env,winner,'mcp').recognize({...a,request_id:uuid()});return batch(statements);};
 await assert.rejects(new PersonnelRecognition(f.env,loser,'web').recognize(a),{code:'PRECONDITION_CHANGED'});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks WHERE archive_id=?').get(a.archive_id).n,1);assert.equal((await new PersonnelRecognition(f.env,loser,'web').summary({archive_id:a.archive_id})).quota.remaining,2);assert.equal(winning.count,3);
});
test('racing targets cannot spend one monthly slot twice; original failed request can be retried safely',async t=>{
 const f=fixture();t.after(f.close);const actor=formalActor(f),a=await target(f),b=await target(f),s=new PersonnelRecognition(f.env,actor,'web'),batch=f.env.DB.batch;
 f.env.DB.batch=async statements=>{f.env.DB.batch=batch;await s.recognize(b);return batch(statements);};
 await assert.rejects(s.recognize(a),{code:'DUPLICATE_VALUE'});assert.equal((await s.summary({archive_id:a.archive_id})).quota.remaining,1);
 const retry=await s.recognize(a);assert.equal(retry.quota_remaining,0);assert.deepEqual(await s.recognize(a),{...retry,replayed:true});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM personnel_recognitions').get().n,2);
});
test('expired or revoked credentials cannot commit even after eligibility was read',async t=>{
 for(const mode of ['expired','revoked']){const f=fixture();try{const a=await target(f),actor=formalActor(f),batch=f.env.DB.batch;
 f.env.DB.batch=async statements=>{f.sqlite.prepare(mode==='expired'?"UPDATE credentials SET expires_at='2000-01-01' WHERE id=?":"UPDATE credentials SET revoked_at='2026-01-01' WHERE id=?").run(actor.credential_id);return batch(statements);};
 await assert.rejects(new PersonnelRecognition(f.env,actor,'web').recognize(a),{code:'PRECONDITION_CHANGED'});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM personnel_recognitions').get().n,0);
 }finally{f.close();}}
});
test('new recognition rounds can use new monthly slots but never reuse a cancelled audit',async t=>{
 const f=fixture();t.after(f.close);const a=await target(f),actors=[formalActor(f),formalActor(f),formalActor(f)],services=actors.map(actor=>new PersonnelRecognition(f.env,actor,'web'));let first;
 for(const s of services)first=await s.recognize({...a,request_id:uuid()});
 const tasks=new WorkTasks(f.env,f.actor,'web');f.actor.role='admin';f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);await tasks.cancel({id:first.task_id,expected_version:1,reason:'取消本轮',request_id:uuid()});
 let second;for(const s of services)second=await s.recognize({...a,round_number:2,request_id:uuid()});assert.notEqual(second.task_id,first.task_id);assert.equal(second.count,3);assert.equal((await services[0].summary({archive_id:a.archive_id})).quota.remaining,0);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_tasks WHERE archive_id=? AND status='open'").get(a.archive_id).n,1);
});
test('0043 migrates existing members and active audits without fake votes or data loss',()=>{
 const db=new DatabaseSync(':memory:');try{
 const dir=new URL('../migrations/',import.meta.url);for(const name of readdirSync(dir).filter(n=>n.endsWith('.sql')&&n<'0043').sort())db.exec(readFileSync(new URL(name,dir),'utf8'));
 const member=uuid(),formal=uuid(),candidate=uuid(),task=uuid(),at=new Date().toISOString();
 db.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,?)").run(member,member,'既有社员',at);
 db.prepare("INSERT INTO archives(id,type,name,status,person_role,linked_account_id,created_by,created_at,updated_at) VALUES(?,'person','既有社员','已入伙','member',?,?,?,?)").run(formal,member,member,at,at);
 db.prepare("INSERT INTO archives(id,type,name,status,person_role,created_by,created_at,updated_at) VALUES(?,'person','在途审核','人事审核','external',?,?,?)").run(candidate,member,at,at);
 db.prepare("INSERT INTO work_tasks(id,archive_id,kind,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at) VALUES(?,?,'audit','在途审核','核对','记录','rule','open','2099-01-01',?,?,?)").run(task,candidate,member,at,at);
 db.exec(readFileSync(new URL('0043_personnel_recognition.sql',dir),'utf8'));
 assert.equal(db.prepare('SELECT count(*) n FROM personnel_legacy_archives').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM personnel_recognitions').get().n,0);assert.equal(db.prepare('SELECT legacy FROM personnel_recognition_rounds WHERE task_id=?').get(task).legacy,1);
 assert.equal(db.prepare('SELECT linked_account_id FROM archives WHERE id=?').get(formal).linked_account_id,member);assert.equal(db.prepare('SELECT status FROM work_tasks WHERE id=?').get(task).status,'open');
 db.prepare("UPDATE work_tasks SET status='completed' WHERE id=?").run(task);assert.equal(db.prepare('SELECT state FROM personnel_recognition_rounds WHERE task_id=?').get(task).state,'closed');
 }finally{db.close();}
});
