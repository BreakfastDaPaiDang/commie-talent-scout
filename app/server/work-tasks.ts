import {z} from 'zod';
import {assertAdmin} from './credentials.ts';
import {command,expectedVersion,requestId,type Source} from './commands.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';
import {matchesPreference,pushCandidates,pushStage,type PushableTaskKind} from '../shared/task-preferences.ts';
import {TagState,type TagLabel} from './tag-state.ts';
import {isMemberStatus} from '../shared/archive-states.ts';
import {Archives} from './archives.ts';
import {auditCancellationTarget,planArchiveEffects} from './rules/archive-lifecycle.ts';

const taskKinds=['audit','onboarding','monthly','cooperation','custom'] as const;
export const workTaskCommentReferenceInput=z.object({observation_id:z.uuid(),content_version:z.number().int().min(1)}).strict();
export const workTaskCreateInput=z.object({archive_id:z.uuid().nullable().default(null),kind:z.enum(taskKinds),title:z.string().trim().min(1).max(160),purpose:z.string().trim().min(1).max(4000),delivery:z.string().trim().min(1).max(4000),deadline_at:z.string().datetime(),source:z.enum(['manual','rule']).default('manual'),request_id:requestId}).strict();
export const workTaskClaimInput=z.object({id:z.uuid(),expected_version:expectedVersion,request_id:requestId}).strict();
export const workTaskAssignInput=z.object({id:z.uuid(),member_id:z.uuid(),expected_version:expectedVersion,reason:z.string().trim().min(1).max(500),request_id:requestId}).strict();
export const workTaskCompleteInput=z.object({id:z.uuid(),expected_version:expectedVersion,result_kind:z.enum(['completed','continue','not_suitable','unable_to_contact','joined','discarded']),result_text:z.string().trim().min(1).max(5000),references:z.array(workTaskCommentReferenceInput).max(20).default([]),request_id:requestId}).strict();
export const workTaskReleaseInput=z.object({id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),reason:z.string().trim().max(500).default('主动交还，重新等待接取'),request_id:requestId}).strict();
export const workTaskCancelInput=z.object({id:z.uuid(),expected_version:expectedVersion,reason:z.string().trim().min(1).max(500),request_id:requestId}).strict();
export const workTaskExtendInput=z.object({id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),reason:z.string().trim().max(500).default('延期任务期限'),request_id:requestId}).strict();
export const workTaskEditInput=z.object({id:z.uuid(),expected_version:expectedVersion,title:z.string().trim().min(1).max(160).optional(),purpose:z.string().trim().min(1).max(4000).optional(),delivery:z.string().trim().min(1).max(4000).optional(),request_id:requestId}).strict().refine(a=>a.title!==undefined||a.purpose!==undefined||a.delivery!==undefined,{message:'至少需要调整一项任务内容'});
export const workTaskReopenInput=z.object({id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),owner_mode:z.enum(['keep','unassigned']).default('keep'),reason:z.string().trim().max(500).default('重新开启任务'),request_id:requestId}).strict();
export const workTaskCommentCreateInput=z.object({task_id:z.uuid(),body:z.string().trim().min(1).max(5000),references:z.array(workTaskCommentReferenceInput).max(20).default([]),request_id:requestId}).strict();
export const workTaskCommentEditInput=z.object({id:z.uuid(),expected_version:expectedVersion,body:z.string().trim().min(1).max(5000),references:z.array(workTaskCommentReferenceInput).max(20).optional(),request_id:requestId}).strict();
export const workTaskCommentDeleteInput=z.object({id:z.uuid(),expected_version:expectedVersion,request_id:requestId}).strict();
export const workTaskCommentRestoreInput=z.object({id:z.uuid(),expected_version:expectedVersion,request_id:requestId}).strict();
export const workTaskReferInput=z.object({archive_id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),request_id:requestId}).strict();
export const workTaskMembershipInput=z.object({archive_id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),request_id:requestId}).strict();
type Row={id:string;archive_id:string|null;kind:typeof taskKinds[number];title:string;purpose:string;delivery:string;source:'manual'|'rule';status:'open'|'completed'|'expired'|'cancelled';owner_id:string|null;deadline_at:string;created_by:string;created_at:string;updated_at:string;version:number;result_kind:string|null;result_text:string|null;result_references_json:string;completed_at:string|null;closed_reason:string|null};
type CommentRow={id:string;task_id:string;author_id:string;author_name:string|null;body:string;references_json:string;created_at:string;updated_at:string;deleted_at:string|null;version:number};

export class WorkTasks {
  constructor(private env:Env,private actor:Actor,private source:Source){ }
  private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
  private event(task:string,kind:string,before:unknown,after:unknown,reason?:string){return this.stmt('INSERT INTO work_task_events(id,task_id,actor_id,source,kind,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),task,this.actor.id,this.source,kind,before?JSON.stringify(before):null,after?JSON.stringify(after):null,reason??null,now());}
  private async get(id:string,version?:number){const row=await this.stmt('SELECT * FROM work_tasks WHERE id=?',id).first<Row>();if(!row)throw new Failure(404,'NOT_FOUND','工作任务不存在');if(version!==undefined&&row.version!==version)throw new Failure(409,'VERSION_CONFLICT','工作任务已被更新，请刷新后重试');return row;}
  private assertOpenDeadline(task:Row){if(task.status!=='open')throw new Failure(409,'TASK_NOT_OPEN','只可操作开放中的任务');if(Date.parse(task.deadline_at)<=Date.now())throw new Failure(409,'TASK_EXPIRED','任务已超过截止时间，请先重新读取并按规则重新开启');}
  private commentTaskGuard(key:string,taskId:string,openOnly=true){return this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? ${openOnly?"AND status='open'":''}) THEN 1 ELSE 0 END)`,key,taskId);}
  private referenceGuard(key:string,task:Row,references:ReadonlyArray<{observation_id:string;content_version:number}>){
    if(!references.length)return null;
    return this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN ? IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(
        SELECT 1 FROM observations o
        JOIN archives ar ON ar.id=o.archive_id AND (ar.deleted=0 OR ?='admin')
        JOIN observation_versions ov ON ov.observation_id=o.id AND ov.version=json_extract(r.value,'$.content_version')
        WHERE o.id=json_extract(r.value,'$.observation_id') AND o.archive_id=?
          AND (o.deleted=0 OR o.author_id=? OR ?='admin')
      )
    ) THEN 1 ELSE 0 END)`,key,task.archive_id,JSON.stringify(references),this.actor.role,task.archive_id,this.actor.id,this.actor.role);
  }
  private async validateReferences(task:Row,references:ReadonlyArray<{observation_id:string;content_version:number}>){
    if(!references.length)return;
    if(!task.archive_id)throw new Failure(400,'TASK_ARCHIVE_REQUIRED','鏈叧鑱旀。妗堢殑浠诲姟涓嶈兘寮曠敤瑙傚療');
    for(const reference of references){
      const row=await this.stmt(`SELECT o.id FROM observations o JOIN archives ar ON ar.id=o.archive_id AND (ar.deleted=0 OR ?='admin') JOIN observation_versions ov ON ov.observation_id=o.id AND ov.version=? WHERE o.id=? AND o.archive_id=? AND (o.deleted=0 OR o.author_id=? OR ?='admin')`,this.actor.role,reference.content_version,reference.observation_id,task.archive_id,this.actor.id,this.actor.role).first();
      if(!row)throw new Failure(403,'REFERENCE_NOT_VISIBLE','引用的观察当前不可见，未保存任务评论');
    }
  }
  private async visibleReference(task:Row,reference:{observation_id:string;content_version:number}){
    if(!task.archive_id)return null;
    const row=await this.stmt(`SELECT o.id observation_id,o.archive_id,ov.version content_version FROM observations o JOIN archives ar ON ar.id=o.archive_id AND (ar.deleted=0 OR ?='admin') JOIN observation_versions ov ON ov.observation_id=o.id AND ov.version=? WHERE o.id=? AND o.archive_id=? AND (o.deleted=0 OR o.author_id=? OR ?='admin')`,this.actor.role,reference.content_version,reference.observation_id,task.archive_id,this.actor.id,this.actor.role).first<{observation_id:string;archive_id:string;content_version:number}>();
    return row?{...row}:null;
  }
  private async comments(task:Row){
    const rows=await this.stmt(`SELECT c.*, (SELECT name FROM members WHERE id=c.author_id) author_name FROM work_task_comments c WHERE c.task_id=? ORDER BY c.created_at,c.id LIMIT 100`,task.id).all<CommentRow>();
    const result=[];
    for(const row of rows.results){
      const refs=JSON.parse(row.references_json||'[]') as {observation_id:string;content_version:number}[];
      const visible=[];for(const reference of refs){const current=await this.visibleReference(task,reference);if(current)visible.push(current);}
      const canSeeDeleted=!row.deleted_at||row.author_id===this.actor.id||this.actor.role==='admin';
      result.push({id:row.id,task_id:row.task_id,author_id:row.author_id,author_name:row.author_name,body:canSeeDeleted?row.body:null,references:visible,references_restricted:visible.length!==refs.length,created_at:row.created_at,updated_at:row.updated_at,deleted:!!row.deleted_at,deleted_at:row.deleted_at,version:row.version});
    }
    return result;
  }
  async create(input:unknown){
    const a=workTaskCreateInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.create',parameters:{archive_id:a.archive_id,kind:a.kind,title:a.title,purpose:a.purpose,delivery:a.delivery,deadline_at:a.deadline_at,source:a.source}},async()=>{
      if(a.deadline_at<=now())throw new Failure(400,'DEADLINE_REQUIRED','开启任务必须有未来期限');
      if(a.archive_id){const archive=await this.stmt('SELECT closed,deleted,status FROM archives WHERE id=?',a.archive_id).first<{closed:number;deleted:number;status:string}>();if(!archive)throw new Failure(404,'ARCHIVE_NOT_FOUND','关联档案不存在');if(archive.deleted)throw new Failure(404,'ARCHIVE_NOT_FOUND','Linked archive is unavailable');if(archive.closed)throw new Failure(409,'ARCHIVE_CLOSED','关闭档案不能创建工作任务');}
      const id=uid(),at=now(),result={id,archive_id:a.archive_id,kind:a.kind,title:a.title,purpose:a.purpose,delivery:a.delivery,source:a.source,status:'open',owner_id:null,deadline_at:a.deadline_at,created_at:at,updated_at:at,version:1,changed:true};
      return {result,statements:[this.stmt('INSERT INTO work_tasks(id,archive_id,kind,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,a.archive_id,a.kind,a.title,a.purpose,a.delivery,a.source,'open',a.deadline_at,this.actor.id,at,at),this.event(id,'task.created',null,result)]};
    });
  }
  async list(input:unknown={}){
    const a=z.object({scope:z.enum(['all','recommended','mine','admin']).default('all'),state:z.enum(['open','closed','all']).default('open'),archive_id:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(input);
    if(a.scope==='admin')assertAdmin(this.actor);
    const where=a.state==='open'?["t.status='open'"]:a.state==='closed'?["t.status<>'open'"]:[],args:unknown[]=[];where.push('(t.archive_id IS NULL OR ar.id IS NOT NULL)');
    if(a.archive_id){where.push('t.archive_id=?');args.push(a.archive_id);}
    if(a.scope==='mine') {where.push('t.owner_id=?');args.push(this.actor.id);}
    if(a.scope==='recommended') {where.push('(t.kind IN (\'audit\',\'onboarding\',\'monthly\',\'cooperation\') AND EXISTS (SELECT 1 FROM member_work_preferences p WHERE p.member_id=? AND (p.all_work=1 OR instr(p.kinds_json,\'"\'||t.kind||\'"\')>0)) AND t.owner_id IS NULL)');args.push(this.actor.id);}
    const rows=await this.stmt(`SELECT t.*,
      (SELECT name FROM members WHERE id=t.owner_id) owner_name,
      ar.type archive_type,
      ar.name archive_name,
      ar.status archive_status,
      ar.version archive_version,
      ar.updated_at archive_updated_at,
      (SELECT count(*) FROM observations o WHERE o.archive_id=ar.id AND o.deleted=0) archive_observation_count,
      (SELECT substr(v.body,1,240) FROM observations o JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version WHERE o.archive_id=ar.id AND o.deleted=0 ORDER BY o.updated_at DESC,o.id DESC LIMIT 1) archive_latest_observation,
      (SELECT json_group_array(json_object('id',m.id,'name',m.name,'frozen',m.frozen)) FROM archive_bindings b JOIN members m ON m.id=b.member_id WHERE b.archive_id=ar.id AND b.status=ar.status) archive_members_json
      FROM work_tasks t
      LEFT JOIN archives ar ON ar.id=t.archive_id AND (ar.deleted=0 OR ?='admin')
      WHERE ${where.join(' AND ')} ORDER BY t.deadline_at,t.created_at,t.id LIMIT ?`,this.actor.role,...args,a.limit).all();
    const tasks=rows.results as (Record<string,unknown>&{archive_id:string|null;archive_members_json?:string|null})[];
    const archiveIds=[...new Set(tasks.map(task=>task.archive_id).filter((id):id is string=>!!id))];
    const tagSummaries=archiveIds.length?await new TagState(this.env,this.actor).summaries(archiveIds):new Map<string,{tags:TagLabel[];total:number}>();
    for(const task of tasks){
      const resultRefs=JSON.parse(String(task.result_references_json??'[]')) as {observation_id:string;content_version:number}[],visibleResultRefs=[];for(const reference of resultRefs){const current=await this.visibleReference(task as unknown as Row,reference);if(current)visibleResultRefs.push(current);}task.result_references=visibleResultRefs;task.result_references_restricted=visibleResultRefs.length!==resultRefs.length;delete task.result_references_json;
      if(task.archive_id&&task.archive_name){
        task.archive_preview={
          id:task.archive_id,
          type:task.archive_type,
          name:task.archive_name,
          status:task.archive_status,
          version:task.archive_version,
          updated_at:task.archive_updated_at,
          observation_count:task.archive_observation_count??0,
          latest_observation:task.archive_latest_observation??null,
          members:JSON.parse(task.archive_members_json??'[]'),
          tag_summary:tagSummaries.get(task.archive_id)??{tags:[],total:0},
        };
      }
      delete task.archive_members_json;
      delete task.archive_type;
      delete task.archive_name;
      delete task.archive_status;
      delete task.archive_version;
      delete task.archive_updated_at;
      delete task.archive_observation_count;
      delete task.archive_latest_observation;
    }
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
    try{
      return await command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.claim',parameters:{id:a.id,expected_version:a.expected_version}},async()=>{
        const task=await this.get(a.id,a.expected_version);this.assertOpenDeadline(task);if(task.owner_id)throw new Failure(409,'TASK_ALREADY_CLAIMED','任务已经有人领取');
        const key=uid(),at=now(),result={id:a.id,owner_id:this.actor.id,status:'open',version:task.version+1,changed:true};
        return {result,statements:[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status=\'open\' AND owner_id IS NULL) THEN 1 ELSE 0 END)',key,a.id,a.expected_version),this.stmt('UPDATE work_tasks SET owner_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=\'open\' AND owner_id IS NULL',this.actor.id,at,a.id,a.expected_version),this.event(a.id,'task.claimed',{owner_id:null,version:task.version},{owner_id:this.actor.id,version:task.version+1}),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
      });
    }catch(error){
      // A stale read and a transaction guard failure are both normal outcomes when
      // two members press Claim together. Re-read only to turn that race into a
      // direct explanation; frozen or expired credentials keep the original auth error.
      if(error instanceof Failure&&(error.code==='VERSION_CONFLICT'||error.code==='PRECONDITION_CHANGED')){
        const current=await this.stmt('SELECT status,owner_id FROM work_tasks WHERE id=?',a.id).first<{status:string;owner_id:string|null}>();
        const auth=await this.stmt(`SELECT m.frozen,m.auth_epoch,c.auth_epoch credential_epoch,c.revoked_at,c.expires_at
          FROM members m JOIN credentials c ON c.member_id=m.id AND c.id=? WHERE m.id=?`,this.actor.credential_id,this.actor.id).first<{frozen:number;auth_epoch:number;credential_epoch:number;revoked_at:string|null;expires_at:string}>();
        if(current?.status==='open'&&current.owner_id&&auth&&auth.frozen===0&&auth.auth_epoch===this.actor.auth_epoch&&auth.credential_epoch===this.actor.auth_epoch&&!auth.revoked_at&&auth.expires_at>now()){
          throw new Failure(409,'TASK_ALREADY_CLAIMED','任务已被其他成员领取，请刷新任务列表');
        }
      }
      throw error;
    }
  }
  async complete(input:unknown){
    const a=workTaskCompleteInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.complete',parameters:{id:a.id,expected_version:a.expected_version,result_kind:a.result_kind,result_text:a.result_text,references:a.references}},async()=>{
      const task=await this.get(a.id,a.expected_version);this.assertOpenDeadline(task);if(task.owner_id!==this.actor.id)throw new Failure(403,'TASK_OWNER_REQUIRED','只有当前负责人可以提交完成结果');await this.validateReferences(task,a.references);
      const key=uid(),at=now(),result={id:a.id,status:'completed',result_kind:a.result_kind,result_text:a.result_text,references:a.references,version:task.version+1,changed:true},refGuard=this.referenceGuard(key+':references',task,a.references);
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status='open' AND owner_id=?) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id),...(refGuard?[refGuard]:[]),this.stmt("UPDATE work_tasks SET status='completed',result_kind=?,result_text=?,result_references_json=?,completed_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='open' AND owner_id=?",a.result_kind,a.result_text,JSON.stringify(a.references),at,at,a.id,a.expected_version,this.actor.id),this.event(a.id,'task.completed',{status:task.status,owner_id:task.owner_id,version:task.version},{status:'completed',owner_id:task.owner_id,result_kind:a.result_kind,result_text:a.result_text,reference_count:a.references.length,version:task.version+1}),this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key,key+':references')]};
    });
  }
  async release(input:unknown){
    const a=workTaskReleaseInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.release',parameters:{id:a.id,expected_version:a.expected_version,deadline_at:a.deadline_at,reason:a.reason}},async()=>{
      const task=await this.get(a.id,a.expected_version);this.assertOpenDeadline(task);if(task.owner_id!==this.actor.id)throw new Failure(403,'TASK_OWNER_REQUIRED','只有当前负责人可以主动交还任务');if(a.deadline_at<=now())throw new Failure(400,'DEADLINE_REQUIRED','重新等待接取必须有未来期限');
      const key=uid(),at=now(),result={id:a.id,status:'open',owner_id:null,deadline_at:a.deadline_at,version:task.version+1,changed:true};
      return {result,statements:[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status=\'open\' AND owner_id=?) THEN 1 ELSE 0 END)',key,a.id,a.expected_version,this.actor.id),this.stmt('UPDATE work_tasks SET owner_id=NULL,deadline_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=\'open\' AND owner_id=?',a.deadline_at,at,a.id,a.expected_version,this.actor.id),this.event(a.id,'task.released',{owner_id:task.owner_id,deadline_at:task.deadline_at,version:task.version},{owner_id:null,deadline_at:a.deadline_at,version:task.version+1},a.reason),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async cancel(input:unknown){
    const a=workTaskCancelInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.cancel',parameters:{id:a.id,expected_version:a.expected_version,reason:a.reason}},async()=>{
      const task=await this.get(a.id,a.expected_version);this.assertOpenDeadline(task);
      const creatorMayCancel=task.created_by===this.actor.id&&!task.owner_id,ownerMayCancel=task.owner_id===this.actor.id;if(this.actor.role!=='admin'&&!creatorMayCancel&&!ownerMayCancel)throw new Failure(403,'TASK_CANCEL_FORBIDDEN','只有创建者取消未接取任务，或管理员取消已接取任务');
      const key=uid(),at=now(),restoration=await this.restoreCancelledAudit(task,at),result={id:a.id,status:'cancelled',owner_id:task.owner_id,version:task.version+1,changed:true,...restoration.result};
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status='open') THEN 1 ELSE 0 END)",key,a.id,a.expected_version),this.stmt("UPDATE work_tasks SET status='cancelled',closed_reason=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='open'",a.reason,at,a.id,a.expected_version),this.event(a.id,'task.cancelled',{status:task.status,owner_id:task.owner_id,version:task.version},{status:'cancelled',owner_id:task.owner_id,version:task.version+1},a.reason),...restoration.statements,this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async edit(input:unknown){
    const a=workTaskEditInput.parse(input),admin=this.actor.role==='admin';
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.edit',parameters:{id:a.id,expected_version:a.expected_version,title:a.title,purpose:a.purpose,delivery:a.delivery},requireAdmin:admin},async()=>{
      const task=await this.get(a.id,a.expected_version);
      this.assertOpenDeadline(task);
      if(this.actor.role!=='admin'&&task.created_by!==this.actor.id&&task.owner_id!==this.actor.id)throw new Failure(403,'TASK_EDIT_FORBIDDEN','只有创建者或当前负责人可以维护任务内容');
      const next={title:a.title??task.title,purpose:a.purpose??task.purpose,delivery:a.delivery??task.delivery},changed=next.title!==task.title||next.purpose!==task.purpose||next.delivery!==task.delivery;
      if(!changed)return {result:{id:task.id,status:task.status,version:task.version,changed:false},statements:[]};
      const key=uid(),at=now(),result={id:task.id,status:task.status,title:next.title,purpose:next.purpose,delivery:next.delivery,version:task.version+1,changed:true};
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks t WHERE t.id=? AND t.version=? AND t.status='open' AND (t.created_by=? OR t.owner_id=? OR EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.role='admin' AND m.frozen=0))) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id,this.actor.id,this.actor.id),this.stmt('UPDATE work_tasks SET title=?,purpose=?,delivery=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=\'open\'',next.title,next.purpose,next.delivery,at,a.id,a.expected_version),this.event(a.id,'task.edited',{title:task.title,purpose:task.purpose,delivery:task.delivery,version:task.version},result),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async extend(input:unknown){
    const a=workTaskExtendInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.extend',parameters:{id:a.id,expected_version:a.expected_version,deadline_at:a.deadline_at,reason:a.reason}},async()=>{
      const task=await this.get(a.id,a.expected_version);this.assertOpenDeadline(task);if(task.owner_id!==this.actor.id)throw new Failure(403,'TASK_OWNER_REQUIRED','只有当前负责人可以延期任务');
      if(Date.parse(a.deadline_at)<=Date.now()||Date.parse(a.deadline_at)<=Date.parse(task.deadline_at))throw new Failure(400,'DEADLINE_REQUIRED','新的截止时间必须晚于原期限并且仍在未来');
      const key=uid(),at=now(),result={id:task.id,status:'open',deadline_at:a.deadline_at,version:task.version+1,changed:true};
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status='open' AND owner_id=?) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id),this.stmt("UPDATE work_tasks SET deadline_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='open' AND owner_id=?",a.deadline_at,at,a.id,a.expected_version,this.actor.id),this.event(a.id,'task.deadline_changed',{deadline_at:task.deadline_at,version:task.version},{deadline_at:a.deadline_at,version:task.version+1},a.reason),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async reopen(input:unknown){
    const a=workTaskReopenInput.parse(input),admin=this.actor.role==='admin';
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.reopen',parameters:{id:a.id,expected_version:a.expected_version,deadline_at:a.deadline_at,owner_mode:a.owner_mode,reason:a.reason},requireAdmin:admin&&a.owner_mode==='unassigned'},async()=>{
      const task=await this.get(a.id,a.expected_version);if(!['expired','cancelled'].includes(task.status))throw new Failure(409,'TASK_NOT_REOPENABLE','只有已过期或已取消的任务可以重新开启');
      if(Date.parse(a.deadline_at)<=Date.now())throw new Failure(400,'DEADLINE_REQUIRED','重新开启必须给出未来截止时间');
      if(a.owner_mode==='keep'&&(this.actor.role!=='admin'&&task.owner_id!==this.actor.id))throw new Failure(403,'TASK_OWNER_REQUIRED','只有原负责人可以保留负责人身份重新开启');
      if(a.owner_mode==='keep'&&this.actor.role==='admin'&&task.owner_id!==this.actor.id)throw new Failure(403,'TASK_OWNER_REQUIRED','管理员为他人重新开启时应明确退回待领取');
      if(a.owner_mode==='unassigned'&&this.actor.role!=='admin')throw new Failure(403,'ADMIN_REQUIRED','只有管理员可以将异常任务退回待领取');
      const nextOwner=a.owner_mode==='keep'?task.owner_id:null,key=uid(),at=now(),result={id:task.id,status:'open',owner_id:nextOwner,deadline_at:a.deadline_at,version:task.version+1,changed:true,previous_result:task.result_kind?{result_kind:task.result_kind,result_text:task.result_text,completed_at:task.completed_at}:null};
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status IN ('expired','cancelled') AND ((?='keep' AND owner_id=?) OR (?='unassigned' AND EXISTS(SELECT 1 FROM members WHERE id=? AND role='admin' AND frozen=0)))) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,a.owner_mode,this.actor.id,a.owner_mode,this.actor.id),this.stmt("UPDATE work_tasks SET status='open',owner_id=?,deadline_at=?,result_kind=NULL,result_text=NULL,completed_at=NULL,closed_reason=NULL,updated_at=?,version=version+1 WHERE id=? AND version=? AND status IN ('expired','cancelled')",nextOwner,a.deadline_at,at,a.id,a.expected_version),this.event(a.id,'task.reopened',{status:task.status,owner_id:task.owner_id,deadline_at:task.deadline_at,result_kind:task.result_kind,result_text:task.result_text,result_reference_count:JSON.parse(task.result_references_json??'[]').length,completed_at:task.completed_at,closed_reason:task.closed_reason,version:task.version},{status:'open',owner_id:nextOwner,deadline_at:a.deadline_at,version:task.version+1},a.reason),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async addComment(input:unknown){
    const a=workTaskCommentCreateInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.comment.create',parameters:{task_id:a.task_id,body:a.body,references:a.references}},async()=>{
      const task=await this.get(a.task_id);this.assertOpenDeadline(task);await this.validateReferences(task,a.references);
      const id=uid(),at=now(),key=uid(),result={id,task_id:task.id,author_id:this.actor.id,body:a.body,references:a.references,version:1,changed:true};const refGuard=this.referenceGuard(key+':references',task,a.references);
      return {result,statements:[this.commentTaskGuard(key,task.id),...(refGuard?[refGuard]:[]),this.stmt('INSERT INTO work_task_comments(id,task_id,author_id,body,references_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',id,task.id,this.actor.id,a.body,JSON.stringify(a.references),at,at),this.event(task.id,'task.comment_created',{comment_id:id},{comment_id:id,version:1,reference_count:a.references.length}),this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key,key+':references')]};
    });
  }
  async editComment(input:unknown){
    const a=workTaskCommentEditInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.comment.edit',parameters:{id:a.id,expected_version:a.expected_version,body:a.body,references:a.references}},async()=>{
      const row=await this.stmt('SELECT * FROM work_task_comments WHERE id=?',a.id).first<CommentRow>();if(!row)throw new Failure(404,'NOT_FOUND','评论不存在');const task=await this.get(row.task_id);this.assertOpenDeadline(task);if(row.deleted_at)throw new Failure(409,'COMMENT_DELETED','已删除评论请先恢复');if(this.actor.role!=='admin'&&row.author_id!==this.actor.id)throw new Failure(403,'COMMENT_AUTHOR_REQUIRED','只有评论作者或管理员可以修改评论');if(row.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','评论已被更新，请刷新后重试');
      const references=a.references??(JSON.parse(row.references_json||'[]') as {observation_id:string;content_version:number}[]);await this.validateReferences(task,references);
      const key=uid(),at=now(),result={id:row.id,task_id:row.task_id,body:a.body,references,version:row.version+1,changed:true};const refGuard=this.referenceGuard(key+':references',task,references);
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_task_comments c JOIN work_tasks t ON t.id=c.task_id WHERE c.id=? AND c.version=? AND c.deleted_at IS NULL AND t.status='open' AND (c.author_id=? OR EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.role='admin' AND m.frozen=0))) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id,this.actor.id),...(refGuard?[refGuard]:[]),this.stmt('UPDATE work_task_comments SET body=?,references_json=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL',a.body,JSON.stringify(references),at,a.id,a.expected_version),this.event(task.id,'task.comment_updated',{comment_id:row.id,version:row.version},{comment_id:row.id,version:row.version+1,reference_count:references.length}),this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key,key+':references')]};
    });
  }
  async deleteComment(input:unknown){
    const a=workTaskCommentDeleteInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.comment.delete',parameters:{id:a.id,expected_version:a.expected_version}},async()=>{
      const row=await this.stmt('SELECT * FROM work_task_comments WHERE id=?',a.id).first<CommentRow>();if(!row)throw new Failure(404,'NOT_FOUND','评论不存在');const task=await this.get(row.task_id);this.assertOpenDeadline(task);if(row.deleted_at)return {result:{id:row.id,task_id:row.task_id,deleted:true,version:row.version,changed:false},statements:[]};if(row.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','评论已被更新，请刷新后重试');if(this.actor.role!=='admin'&&row.author_id!==this.actor.id)throw new Failure(403,'COMMENT_AUTHOR_REQUIRED','只有评论作者或管理员可以删除评论');
      const key=uid(),at=now(),result={id:row.id,task_id:row.task_id,deleted:true,deleted_at:at,version:row.version+1,changed:true};
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_task_comments c JOIN work_tasks t ON t.id=c.task_id WHERE c.id=? AND c.version=? AND c.deleted_at IS NULL AND t.status='open' AND (c.author_id=? OR EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.role='admin' AND m.frozen=0))) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id,this.actor.id),this.stmt('UPDATE work_task_comments SET deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL',at,at,a.id,a.expected_version),this.event(task.id,'task.comment_deleted',{comment_id:row.id,version:row.version},{comment_id:row.id,version:row.version+1}),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async restoreComment(input:unknown){
    const a=workTaskCommentRestoreInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.comment.restore',parameters:{id:a.id,expected_version:a.expected_version}},async()=>{
      const row=await this.stmt('SELECT * FROM work_task_comments WHERE id=?',a.id).first<CommentRow>();if(!row)throw new Failure(404,'NOT_FOUND','评论不存在');const task=await this.get(row.task_id);this.assertOpenDeadline(task);if(!row.deleted_at)return {result:{id:row.id,task_id:row.task_id,deleted:false,version:row.version,changed:false},statements:[]};if(row.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','评论已被更新，请刷新后重试');if(this.actor.role!=='admin'&&row.author_id!==this.actor.id)throw new Failure(403,'COMMENT_AUTHOR_REQUIRED','只有评论作者或管理员可以恢复评论');
      const key=uid(),at=now(),result={id:row.id,task_id:row.task_id,deleted:false,version:row.version+1,changed:true};
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_task_comments c JOIN work_tasks t ON t.id=c.task_id WHERE c.id=? AND c.version=? AND c.deleted_at IS NOT NULL AND t.status='open' AND (c.author_id=? OR EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.role='admin' AND m.frozen=0))) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id,this.actor.id),this.stmt('UPDATE work_task_comments SET deleted_at=NULL,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NOT NULL',at,a.id,a.expected_version),this.event(task.id,'task.comment_restored',{comment_id:row.id,version:row.version},{comment_id:row.id,version:row.version+1}),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  private async restoreCancelledAudit(task:Row,at:string){
    const unchanged={result:{},statements:[] as D1PreparedStatement[]};if(!task.archive_id||task.kind!=='audit'||task.source!=='rule')return unchanged;
    const current=await this.stmt('SELECT status,closed,deleted FROM archives WHERE id=?',task.archive_id).first<{status:string;closed:number;deleted:number}>();if(!current||current.closed||current.deleted||current.status!=='人事审核')return unchanged;
    const archives=new Archives(this.env,this.actor,this.source),old=await archives.get(task.archive_id);
    const event=await this.stmt("SELECT before_json,after_json FROM archive_events WHERE archive_id=? AND kind='archive.state_changed' ORDER BY seq DESC LIMIT 1",old.id).first<{before_json:string|null;after_json:string|null}>();
    const status=auditCancellationTarget(task,old,event?{before:event.before_json?JSON.parse(event.before_json):null,after:event.after_json?JSON.parse(event.after_json):null}:null);if(!status)return unchanged;
    const members=old.bindings[status]??[],key=uid(),bindings=members.map(member=>this.stmt('INSERT INTO archive_bindings(archive_id,status,member_id) VALUES(?,?,?)',old.id,status,member.id));
    return {result:{archive_id:old.id,archive_status:status,archive_version:old.version+1},statements:[archives.guard(old.id,old.version,key),...planArchiveEffects({old,status,memberIds:members.map(member=>member.id).sort(),reopen:false,at,actorId:this.actor.id,source:this.source,members,bindings,tags:new TagState(this.env,this.actor),stmt:this.stmt.bind(this),event:archives.event.bind(archives)}),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
  }
  async detail(id:string){
    const task=await this.get(id);if(task.archive_id)await new Archives(this.env,this.actor,this.source).get(task.archive_id);const resultRefs=JSON.parse(task.result_references_json??'[]') as {observation_id:string;content_version:number}[],visibleResultRefs=[];for(const reference of resultRefs){const current=await this.visibleReference(task,reference);if(current)visibleResultRefs.push(current);}const safeTask={...task,result_references:visibleResultRefs,result_references_restricted:visibleResultRefs.length!==resultRefs.length};delete (safeTask as {result_references_json?:string}).result_references_json;const events=await this.stmt('SELECT e.id,e.actor_id,(SELECT name FROM members WHERE id=e.actor_id) actor_name,e.source,e.kind,e.before_json,e.after_json,e.reason,e.created_at FROM work_task_events e WHERE e.task_id=? ORDER BY e.rowid DESC LIMIT 100',id).all<Record<string,unknown>>();return {task:safeTask,events:events.results,comments:await this.comments(task)};
  }
  async expire(at=now()){
    const rows=await this.stmt("SELECT * FROM work_tasks WHERE status='open' AND deadline_at<=? ORDER BY deadline_at,id",at).all<Row>();
    const statements:D1PreparedStatement[]=[];for(const task of rows.results){const key=uid();statements.push(this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status='open' AND deadline_at<=?) THEN 1 ELSE 0 END)",key,task.id,task.version,at),this.stmt("UPDATE work_tasks SET status='expired',closed_reason='超过截止时间',updated_at=?,version=version+1 WHERE id=? AND version=? AND status='open' AND deadline_at<=?",at,task.id,task.version,at),this.stmt('INSERT INTO work_task_events(id,task_id,actor_id,source,kind,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),task.id,this.actor.id,'system','task.expired',JSON.stringify({status:task.status,owner_id:task.owner_id,deadline_at:task.deadline_at,version:task.version}),JSON.stringify({status:'expired',owner_id:task.owner_id,version:task.version+1}),null,at),this.stmt('DELETE FROM mutation_guards WHERE id=?',key));}
    if(statements.length)await this.env.DB.batch(statements);return {count:rows.results.length};
  }
  async refer(input:unknown){
    const a=workTaskReferInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'archive.refer',parameters:{archive_id:a.archive_id,expected_version:a.expected_version,deadline_at:a.deadline_at}},async()=>{
      const archive=await this.stmt('SELECT id,type,name,status,closed,deleted,version FROM archives WHERE id=?',a.archive_id).first<{id:string;type:'person'|'org';name:string;status:string;closed:number;deleted:number;version:number}>();
      if(!archive||archive.deleted)throw new Failure(404,'NOT_FOUND','档案不存在');if(archive.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','档案已被更新，请刷新后重试');if(archive.type!=='person')throw new Failure(400,'PERSON_ARCHIVE_REQUIRED','只有外部人物可以发起人事审核');if(archive.closed)throw new Failure(409,'ARCHIVE_CLOSED','关闭档案不能发起引荐');
      if(isMemberStatus(archive.status))throw new Failure(409,'INVALID_REFERRAL_STAGE','社员不能作为外部人物提交审核');
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
      const task=await this.get(a.id,a.expected_version);this.assertOpenDeadline(task);
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
