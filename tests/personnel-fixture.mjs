import {randomUUID as uuid} from 'node:crypto';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {PersonnelRecognition} from '../app/server/personnel-recognition.ts';
// Seed pre-1.1 data only. Restore every production trigger before exercising services.
export function historicalSql(f,fn){
 const triggers=f.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('personnel_no_direct_insert','personnel_review_gate','personnel_no_skip_stages')").all();
 for(const t of triggers)f.sqlite.exec(`DROP TRIGGER ${t.name}`);
 try{return fn();}finally{for(const t of triggers)f.sqlite.exec(t.sql);}
}
export async function historicalArchive(f,service,input){
 const desired=input.status??'视奸观察';
 if(!['人事审核','已加入待对接','已入伙'].includes(desired))return service.create(input);
 const a=await service.create({...input,status:['人事审核','已加入待对接','已入伙'].includes(desired)?'视奸观察':desired,member_status:undefined,linked_account_id:null});
 const role=input.type==='person'?(desired==='已入伙'?'member':'external'):null;
 historicalSql(f,()=>f.sqlite.prepare('UPDATE archives SET status=?,person_role=?,member_status=?,member_work_paused=? WHERE id=?').run(desired,role,role==='member'?(input.member_status==='暂不接工作'?'可接工作':input.member_status??'可接工作'):null,input.member_status==='暂不接工作'?1:0,a.id));
 if(input.linked_account_id){const old=await service.get(a.id);await service.update({id:a.id,expected_version:old.version,name:input.name,contacts:old.contacts,links:old.links,linked_account_id:input.linked_account_id,request_id:uuid()});a.version++;}
 if(role==='member'||['人事审核','已加入待对接'].includes(desired))f.sqlite.prepare('INSERT INTO personnel_legacy_archives VALUES(?)').run(a.id);
 f.sqlite.prepare('UPDATE archive_events SET after_json=json_set(after_json,\'$.status\',?,\'$.person_role\',?) WHERE archive_id=? AND kind=\'archive.created\'').run(desired,role,a.id);
 if(input.member_ids?.length)for(const id of input.member_ids)f.sqlite.prepare('INSERT OR IGNORE INTO archive_bindings VALUES(?,?,?)').run(a.id,desired,id);
 if(['人事审核','已加入待对接'].includes(desired))seedRuleTask(f,a.id,desired==='人事审核'?'audit':'onboarding');
 return {...a,person_role:role,member_status:input.member_status??(role==='member'?'可接工作':null),contact_reminder:(await service.get(a.id)).contact_reminder};
}
export function seedRuleTask(f,archiveId,kind='audit'){
 const id=uuid(),at=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO work_tasks(id,archive_id,kind,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at,initiator_kind,initiator_id,priority,labels_json) VALUES(?,?,?,'历史人事任务','核对','留档交付','rule','open','2099-01-01T00:00:00.000Z',?,?,?,'member',?,'P1',?)").run(id,archiveId,kind,f.actor.id,at,at,f.actor.id,JSON.stringify([kind]));
 return f.sqlite.prepare('SELECT * FROM work_tasks WHERE id=?').get(id);
}
export function formalActor(f,options={}){
 const id=options.accountId??uuid(),archiveId=uuid(),credential=uuid(),at=new Date().toISOString();
 if(!options.accountId)f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at,identity_kind) VALUES(?,?,?,?,'fixture',0,?,?)").run(id,id,options.name??'虚构认可社员',options.role??'member',at,options.identity_kind??'human');
 f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at,purpose) VALUES(?,?,?,'mcp','fixture',1,?,'2099-01-01T00:00:00.000Z',?)").run(credential,id,uuid(),at,options.identity_kind==='service'?'verification':'interactive');
 if(options.identity_kind!=='service'){
 historicalSql(f,()=>f.sqlite.prepare("INSERT INTO archives(id,type,name,status,person_role,member_status,linked_account_id,created_by,created_at,updated_at) VALUES(?,'person',?,'已入伙','member','可接工作',?,?,?,?)").run(archiveId,options.name??'虚构认可社员',id,id,at,at));
 f.sqlite.prepare('INSERT INTO personnel_legacy_archives VALUES(?)').run(archiveId);}
 return {...f.sqlite.prepare('SELECT * FROM members WHERE id=?').get(id),credential_id:credential,credential_kind:'mcp',archiveId};
}
// A pre-1.1 referral is setup for regression tests of already-running tasks.
export async function legacyReferral(f,archiveId,source='web'){
 const service=new Archives(f.env,f.actor,source),old=await service.get(archiveId),at=new Date().toISOString();
 const task=seedRuleTask(f,archiveId,'audit');
 historicalSql(f,()=>f.sqlite.prepare("UPDATE archives SET status='人事审核',version=version+1,updated_at=? WHERE id=?").run(at,archiveId));
 await service.event(archiveId,'archive.state_changed',{status:old.status,members:old.members},{status:'人事审核',members:[],task_id:task.id},at).run();
 f.sqlite.prepare('INSERT OR IGNORE INTO personnel_legacy_archives VALUES(?)').run(archiveId);
 return {task_id:task.id,id:task.id,archive_id:archiveId,archive_version:old.version+1,version:old.version+1,archive_status:'人事审核',changed:true,reused:false};
}
export async function legacyState(f,service,input){
 const old=await service.get(input.id),at=new Date().toISOString();
 historicalSql(f,()=>f.sqlite.prepare('UPDATE archives SET status=?,person_role=?,member_status=?,version=version+1,updated_at=? WHERE id=?').run(input.status,input.status==='已入伙'?'member':'external',input.status==='已入伙'?input.member_status??'可接工作':null,at,input.id));
 const task=['人事审核','已加入待对接'].includes(input.status)?seedRuleTask(f,input.id,input.status==='人事审核'?'audit':'onboarding'):null;
 await service.event(input.id,'archive.state_changed',{status:old.status,members:old.members},{status:input.status,members:[],...(task?{task_id:task.id}:{})},at).run();
 return {id:input.id,version:old.version+1,archive_version:old.version+1,status:input.status,task_id:task?.id,changed:true,closed:false,membership_joined:input.status==='已入伙'};
}
export async function recognizeThree(f,archiveId,source='web'){
 const observation=await new Observations(f.env,f.actor,source).create({archive_id:archiveId,body:'虚构且明确的工作经历，作为人员认可依据。',request_id:uuid()});
 let result;
 for(let i=0;i<3;i++){const actor=formalActor(f),service=new PersonnelRecognition(f.env,actor,source),s=await service.summary({archive_id:archiveId});result=await service.recognize({archive_id:archiveId,round_number:s.round_number,observation_id:observation.id,content_version:1,request_id:uuid()});}
 return {...result,archive_version:(await new Archives(f.env,f.actor,source).get(archiveId)).version};
}
