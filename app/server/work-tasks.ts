import {z} from 'zod';
import {assertAdmin} from './credentials.ts';
import {command,expectedVersion,requestId,type Source} from './commands.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';
import {matchesPreference,pushCandidates,pushStage,type PushableTaskKind} from '../shared/task-preferences.ts';

const taskKinds=['audit','onboarding','monthly','cooperation','custom'] as const;
export const workTaskCreateInput=z.object({archive_id:z.uuid().nullable().default(null),kind:z.enum(taskKinds),title:z.string().trim().min(1).max(160),purpose:z.string().trim().min(1).max(4000),delivery:z.string().trim().min(1).max(4000),deadline_at:z.string().datetime(),source:z.enum(['manual','rule']).default('manual'),request_id:requestId}).strict();
export const workTaskClaimInput=z.object({id:z.uuid(),expected_version:expectedVersion,request_id:requestId}).strict();
type Row={id:string;archive_id:string|null;kind:typeof taskKinds[number];title:string;purpose:string;delivery:string;source:'manual'|'rule';status:'open'|'completed'|'expired'|'cancelled';owner_id:string|null;deadline_at:string;created_by:string;created_at:string;updated_at:string;version:number};

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
  async duePushes(at=now()){
    const rows=await this.stmt("SELECT * FROM work_tasks WHERE status='open' AND owner_id IS NULL AND created_at<=?",at).all<Row>();const statements:D1PreparedStatement[]=[];let count=0;
    for(const task of rows.results){const stage=pushStage(this.pushable(task),at);if(stage==='admin')continue;const members=await this.candidates(task);for(const member of members){const exists=await this.stmt('SELECT 1 FROM work_task_pushes WHERE task_id=? AND member_id=? AND stage=?',task.id,member.id,stage).first();if(!exists){statements.push(this.stmt('INSERT INTO work_task_pushes(id,task_id,member_id,stage,pushed_at) VALUES(?,?,?,?,?)',uid(),task.id,member.id,stage,at));count++;}}}
    if(statements.length)await this.env.DB.batch(statements);return {count};
  }
}
