import {z} from 'zod';
import {assertAdmin} from './credentials.ts';
import {command,expectedVersion,requestId,type Source} from './commands.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';
import {matchesPreference,pushCandidates,pushStage,type PushableTaskKind} from '../shared/task-preferences.ts';

const taskKinds=['audit','onboarding','monthly','cooperation','custom'] as const;
export const workTaskCreateInput=z.object({archive_id:z.uuid().nullable().default(null),kind:z.enum(taskKinds),title:z.string().trim().min(1).max(160),purpose:z.string().trim().min(1).max(4000),delivery:z.string().trim().min(1).max(4000),deadline_at:z.string().datetime(),source:z.enum(['manual','rule']).default('manual'),request_id:requestId}).strict();
export const workTaskClaimInput=z.object({id:z.uuid(),expected_version:expectedVersion,request_id:requestId}).strict();
export const workTaskAssignInput=z.object({id:z.uuid(),member_id:z.uuid(),expected_version:expectedVersion,reason:z.string().trim().min(1).max(500),request_id:requestId}).strict();
export const workTaskCompleteInput=z.object({id:z.uuid(),expected_version:expectedVersion,result_kind:z.enum(['completed','continue','not_suitable','unable_to_contact','joined','discarded']),result_text:z.string().trim().min(1).max(5000),request_id:requestId}).strict();
export const workTaskReleaseInput=z.object({id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),reason:z.string().trim().max(500).default('主动交还，重新等待接取'),request_id:requestId}).strict();
export const workTaskReferInput=z.object({archive_id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),request_id:requestId}).strict();
export const workTaskMembershipInput=z.object({archive_id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),request_id:requestId}).strict();
type Row={id:string;archive_id:string|null;kind:typeof taskKinds[number];title:string;purpose:string;delivery:string;source:'manual'|'rule';status:'open'|'completed'|'expired'|'cancelled';owner_id:string|null;deadline_at:string;created_by:string;created_at:string;updated_at:string;version:number;result_kind:string|null;result_text:string|null;completed_at:string|null;closed_reason:string|null};

export class WorkTasks {
  constructor(private env:Env,private actor:Actor,private source:Source){ }
  private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
  private event(task:string,kind:string,before:unknown,after:unknown,reason?:string){return this.stmt('INSERT INTO work_task_events(id,task_id,actor_id,source,kind,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),task,this.actor.id,this.source,kind,before?JSON.stringify(before):null,after?JSON.stringify(after):null,reason??null,now());}
  private async get(id:string,version?:number){const row=await this.stmt('SELECT * FROM work_tasks WHERE id=?',id).first<Row>();if(!row)throw new Failure(404,'NOT_FOUND','工作任务不存在');if(version!==undefined&&row.version!==version)throw new Failure(409,'VERSION_CONFLICT','工作任务已被更新，请刷新后重试');return row;}
  async create(input:unknown){
    const a=workTaskCreateInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.create',parameters:{archive_id:a.archive_id,kind:a.kind,title:a.title,purpose:a.purpose,delivery:a.delivery,deadline_at:a.deadline_at,source:a.source}},async()=>{
      if(a.deadline_at<=now())throw new Failure(400,'DEADLINE_REQUIRED','开启任务必须有未来期限');
      if(a.archive_id){const archive=await this.stmt('SELECT closed,status FROM archives WHERE id=?',a.archive_id).first<{closed:number;status:string}>();if(!archive)throw new Failure(404,'ARCHIVE_NOT_FOUND','关联档案不存在');if(archive.closed)throw new Failure(409,'ARCHIVE_CLOSED','关闭档案不能创建工作任务');}
      const id=uid(),at=now(),result={id,archive_id:a.archive_id,kind:a.kind,title:a.title,purpose:a.purpose,delivery:a.delivery,source:a.source,status:'open',owner_id:null,deadline_at:a.deadline_at,created_at:at,updated_at:at,version:1,changed:true};
      return {result,statements:[this.stmt('INSERT INTO work_tasks(id,archive_id,kind,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,a.archive_id,a.kind,a.title,a.purpose,a.delivery,a.source,'open',a.deadline_at,this.actor.id,at,at),this.event(id,'task.created',null,result)]};
    });
  }
  async list(input:unknown={}){
    const a=z.object({scope:z.enum(['all','recommended','mine','admin']).default('all'),archive_id:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(input);
    if(a.scope==='admin')assertAdmin(this.actor);
    const where=['t.status=\'open\''],args:unknown[]=[];
    if(a.archive_id){where.push('t.archive_id=?');args.push(a.archive_id);}
    if(a.scope==='mine') {where.push('t.owner_id=?');args.push(this.actor.id);}
    if(a.scope==='recommended') {where.push('(t.kind IN (\'audit\',\'onboarding\',\'monthly\',\'cooperation\') AND EXISTS (SELECT 1 FROM member_work_preferences p WHERE p.member_id=? AND (p.all_work=1 OR instr(p.kinds_json,\'"\'||t.kind||\'"\')>0)) AND t.owner_id IS NULL)');args.push(this.actor.id);}
    const rows=await this.stmt(`SELECT t.*,(SELECT name FROM members WHERE id=t.owner_id) owner_name FROM work_tasks t WHERE ${where.join(' AND ')} ORDER BY t.deadline_at,t.created_at,t.id LIMIT ?`,...args,a.limit).all();
    const tasks=rows.results as Record<string,unknown>[];
    if(a.scope==='admin') for(const task of tasks){const candidates=await this.candidates(task as unknown as Row);task.candidate_count=candidates.length;task.push_stage=pushStage(this.pushable(task as unknown as Row),now());}
    return {tasks};
  }
  private async candidates(task:Row){
    const rows=await this.stmt(`SELECT m.id,m.name,m.frozen,p.all_work,p.kinds_json FROM members m LEFT JOIN member_work_preferences p ON p.member_id=m.id WHERE m.frozen=0 ORDER BY m.name,m.id`).all<{id:string;name:string;frozen:number;all_work:number|null;kinds_json:string|null}>();
    return pushCandidates(this.pushable(task),rows.results.map(r=>({id:r.id,name:r.name,frozen:!!r.frozen,preference:r.all_work===null?null:{memberId:r.id,all:!!r.all_work,kinds:JSON.parse(r.kinds_json??'[]') as PushableTaskKind[]}})));
  }
  private pushable(task:Row){return {id:task.id,kind:task.kind,open:task.status==='open',ownerId:task.owner_id,createdAt:task.created_at};}
  async claim(input:unknown){
    const a=workTaskClaimInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.claim',parameters:{id:a.id,expected_version:a.expected_version}},async()=>{
      const task=await this.get(a.id,a.expected_version);if(task.status!=='open')throw new Failure(409,'TASK_NOT_OPEN','只有开启中的任务可以领取');if(task.owner_id)throw new Failure(409,'TASK_ALREADY_CLAIMED','任务已经有人领取');
      const key=uid(),at=now(),result={id:a.id,owner_id:this.actor.id,status:'open',version:task.version+1,changed:true};
      return {result,statements:[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status=\'open\' AND owner_id IS NULL) THEN 1 ELSE 0 END)',key,a.id,a.expected_version),this.stmt('UPDATE work_tasks SET owner_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=\'open\' AND owner_id IS NULL',this.actor.id,at,a.id,a.expected_version),this.event(a.id,'task.claimed',{owner_id:null,version:task.version},{owner_id:this.actor.id,version:task.version+1}),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async complete(input:unknown){
    const a=workTaskCompleteInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.complete',parameters:{id:a.id,expected_version:a.expected_version,result_kind:a.result_kind,result_text:a.result_text},},async()=>{
      const task=await this.get(a.id,a.expected_version);if(task.status!=='open')throw new Failure(409,'TASK_NOT_OPEN','只有开启中的任务可以完成');if(task.owner_id!==this.actor.id)throw new Failure(403,'TASK_OWNER_REQUIRED','只有当前负责人可以提交完成结果');
      const key=uid(),at=now(),result={id:a.id,status:'completed',result_kind:a.result_kind,result_text:a.result_text,version:task.version+1,changed:true};
      return {result,statements:[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status=\'open\' AND owner_id=?) THEN 1 ELSE 0 END)',key,a.id,a.expected_version,this.actor.id),this.stmt('UPDATE work_tasks SET status=\'completed\',result_kind=?,result_text=?,completed_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=\'open\' AND owner_id=?',a.result_kind,a.result_text,at,at,a.id,a.expected_version,this.actor.id),this.event(a.id,'task.completed',{status:task.status,owner_id:task.owner_id,version:task.version},{status:'completed',owner_id:task.owner_id,result_kind:a.result_kind,result_text:a.result_text,version:task.version+1}),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async release(input:unknown){
    const a=workTaskReleaseInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.release',parameters:{id:a.id,expected_version:a.expected_version,deadline_at:a.deadline_at,reason:a.reason}},async()=>{
      const task=await this.get(a.id,a.expected_version);if(task.status!=='open'||task.owner_id!==this.actor.id)throw new Failure(403,'TASK_OWNER_REQUIRED','只有当前负责人可以主动交还任务');if(a.deadline_at<=now())throw new Failure(400,'DEADLINE_REQUIRED','重新等待接取必须有未来期限');
      const key=uid(),at=now(),result={id:a.id,status:'open',owner_id:null,deadline_at:a.deadline_at,version:task.version+1,changed:true};
      return {result,statements:[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status=\'open\' AND owner_id=?) THEN 1 ELSE 0 END)',key,a.id,a.expected_version,this.actor.id),this.stmt('UPDATE work_tasks SET owner_id=NULL,deadline_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=\'open\' AND owner_id=?',a.deadline_at,at,a.id,a.expected_version,this.actor.id),this.event(a.id,'task.released',{owner_id:task.owner_id,deadline_at:task.deadline_at,version:task.version},{owner_id:null,deadline_at:a.deadline_at,version:task.version+1},a.reason),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async detail(id:string){
    const task=await this.get(id);const events=await this.stmt('SELECT e.id,e.actor_id,(SELECT name FROM members WHERE id=e.actor_id) actor_name,e.source,e.kind,e.before_json,e.after_json,e.reason,e.created_at FROM work_task_events e WHERE e.task_id=? ORDER BY e.rowid DESC LIMIT 100',id).all<Record<string,unknown>>();return {task,events:events.results};
  }
  async refer(input:unknown){
    const a=workTaskReferInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'archive.refer',parameters:{archive_id:a.archive_id,expected_version:a.expected_version,deadline_at:a.deadline_at}},async()=>{
      const archive=await this.stmt('SELECT id,type,name,status,closed,deleted,version FROM archives WHERE id=?',a.archive_id).first<{id:string;type:'person'|'org';name:string;status:string;closed:number;deleted:number;version:number}>();
      if(!archive||archive.deleted)throw new Failure(404,'NOT_FOUND','档案不存在');if(archive.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','档案已被更新，请刷新后重试');if(archive.type!=='person')throw new Failure(400,'PERSON_ARCHIVE_REQUIRED','只有外部人物可以发起人事审核');if(archive.closed)throw new Failure(409,'ARCHIVE_CLOSED','关闭档案不能发起引荐');
      const existing=await this.stmt("SELECT id,version FROM work_tasks WHERE archive_id=? AND kind='audit' AND status='open'",a.archive_id).first<{id:string;version:number}>();if(existing)return {result:{id:existing.id,task_id:existing.id,archive_id:a.archive_id,status:'open',archive_status:'人事审核',archive_version:archive.version,reused:true,changed:false},statements:[]};
      if(a.deadline_at<=now())throw new Failure(400,'DEADLINE_REQUIRED','审核任务必须有未来期限');
      const taskId=uid(),key=uid(),at=now(),nextVersion=archive.version+1,task={id:taskId,archive_id:a.archive_id,kind:'audit',title:`${archive.name} · 人事审核`,purpose:'了解对方情况、意愿以及可能参与的方向，形成有依据的审核结论。',delivery:'提交审核期间的观察与结论，结果留在关联人物档案。',source:'rule',status:'open',owner_id:null,deadline_at:a.deadline_at,created_at:at,updated_at:at,version:1};
      return {result:{id:taskId,task_id:taskId,archive_id:a.archive_id,status:'open',archive_status:'人事审核',archive_version:nextVersion,reused:false,changed:true},statements:[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archives WHERE id=? AND version=? AND deleted=0 AND closed=0) THEN 1 ELSE 0 END)',key,a.archive_id,a.expected_version),this.stmt("UPDATE archives SET status='人事审核',closed=0,version=version+1,updated_at=? WHERE id=? AND version=? AND deleted=0 AND closed=0",at,a.archive_id,a.expected_version),this.stmt('INSERT INTO work_tasks(id,archive_id,kind,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',taskId,a.archive_id,task.kind,task.title,task.purpose,task.delivery,task.source,'open',task.deadline_at,this.actor.id,at,at),this.stmt('INSERT INTO archive_events(id,archive_id,actor_id,source,kind,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),a.archive_id,this.actor.id,this.source,'archive.state_changed',JSON.stringify({status:archive.status}),JSON.stringify({status:'人事审核',task_id:taskId}),at),this.event(taskId,'task.created',null,task),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async confirmMembership(input:unknown){
    const a=workTaskMembershipInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'archive.confirm_membership',parameters:{archive_id:a.archive_id,expected_version:a.expected_version,deadline_at:a.deadline_at}},async()=>{
      const archive=await this.stmt('SELECT id,type,name,status,closed,deleted,version FROM archives WHERE id=?',a.archive_id).first<{id:string;type:'person'|'org';name:string;status:string;closed:number;deleted:number;version:number}>();
      if(!archive||archive.deleted)throw new Failure(404,'NOT_FOUND','档案不存在');if(archive.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','档案已被更新，请刷新后重试');if(archive.type!=='person')throw new Failure(400,'PERSON_ARCHIVE_REQUIRED','只有人物档案可以确认入社');if(archive.closed)throw new Failure(409,'ARCHIVE_CLOSED','关闭档案不能确认入社');if(archive.status!=='人事审核')throw new Failure(409,'INVALID_MEMBERSHIP_STAGE','只有人事审核中的档案可以确认入社');
      const audit=await this.stmt("SELECT id FROM work_tasks WHERE archive_id=? AND kind='audit' AND status='completed' ORDER BY completed_at DESC LIMIT 1",a.archive_id).first<{id:string}>();if(!audit)throw new Failure(409,'AUDIT_RESULT_REQUIRED','请先完成并提交人事审核结果');
      const existing=await this.stmt("SELECT id FROM work_tasks WHERE archive_id=? AND kind='onboarding' AND status='open'",a.archive_id).first<{id:string}>();if(existing)return {result:{id:existing.id,task_id:existing.id,archive_id:a.archive_id,status:'open',archive_status:'已加入待对接',archive_version:archive.version,reused:true,changed:false},statements:[]};
      if(a.deadline_at<=now())throw new Failure(400,'DEADLINE_REQUIRED','入社对接任务必须有未来期限');
      const taskId=uid(),key=uid(),at=now(),nextVersion=archive.version+1,task={id:taskId,archive_id:a.archive_id,kind:'onboarding',title:`${archive.name} · 入社对接`,purpose:'向新社员介绍组织与参与方式，落实后续联系和参与安排。',delivery:'提交对接期间的结果，并记录未解决事项或后续安排。',source:'rule',status:'open',owner_id:null,deadline_at:a.deadline_at,created_at:at,updated_at:at,version:1};
      return {result:{id:taskId,task_id:taskId,archive_id:a.archive_id,status:'open',archive_status:'已加入待对接',archive_version:nextVersion,reused:false,changed:true},statements:[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM archives WHERE id=? AND version=? AND deleted=0 AND closed=0) THEN 1 ELSE 0 END)',key,a.archive_id,a.expected_version),this.stmt("UPDATE archives SET status='已加入待对接',closed=0,version=version+1,updated_at=? WHERE id=? AND version=? AND deleted=0 AND closed=0",at,a.archive_id,a.expected_version),this.stmt('INSERT INTO work_tasks(id,archive_id,kind,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',taskId,a.archive_id,task.kind,task.title,task.purpose,task.delivery,task.source,'open',task.deadline_at,this.actor.id,at,at),this.stmt('INSERT INTO archive_events(id,archive_id,actor_id,source,kind,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),a.archive_id,this.actor.id,this.source,'archive.membership_confirmed',JSON.stringify({status:archive.status,audit_task_id:audit.id}),JSON.stringify({status:'已加入待对接',task_id:taskId}),at),this.event(taskId,'task.created',null,task),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async assign(input:unknown){
    assertAdmin(this.actor);const a=workTaskAssignInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.assign',parameters:{id:a.id,member_id:a.member_id,expected_version:a.expected_version,reason:a.reason},requireAdmin:true},async()=>{
      const task=await this.get(a.id,a.expected_version);if(task.status!=='open')throw new Failure(409,'TASK_NOT_OPEN','只有开启中的任务可以指派');
      const member=await this.stmt('SELECT id,frozen FROM members WHERE id=?',a.member_id).first<{id:string;frozen:number}>();if(!member||member.frozen)throw new Failure(409,'MEMBER_NOT_ELIGIBLE','只能指派给未冻结的成员');
      const key=uid(),at=now(),result={id:a.id,owner_id:a.member_id,status:'open',version:task.version+1,changed:true,assigned:true};
      return {result,statements:[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status=\'open\') THEN 1 ELSE 0 END)',key,a.id,a.expected_version),this.stmt('UPDATE work_tasks SET owner_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=\'open\'',a.member_id,at,a.id,a.expected_version),this.event(a.id,'task.assigned',{owner_id:task.owner_id,version:task.version},{owner_id:a.member_id,version:task.version+1},a.reason),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async duePushes(at=now()){
    const rows=await this.stmt("SELECT * FROM work_tasks WHERE status='open' AND owner_id IS NULL AND created_at<=?",at).all<Row>();const statements:D1PreparedStatement[]=[];let count=0;
    for(const task of rows.results){const stage=pushStage(this.pushable(task),at);if(stage==='admin')continue;const members=await this.candidates(task);for(const member of members){const exists=await this.stmt('SELECT 1 FROM work_task_pushes WHERE task_id=? AND member_id=? AND stage=?',task.id,member.id,stage).first();if(!exists){statements.push(this.stmt('INSERT INTO work_task_pushes(id,task_id,member_id,stage,pushed_at) VALUES(?,?,?,?,?)',uid(),task.id,member.id,stage,at));count++;}}}
    if(statements.length)await this.env.DB.batch(statements);return {count};
  }
}
