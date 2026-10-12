import {taskOverdue} from '../rules/task-notifications.ts';
import {taskKinds,taskPriorities,taskLabelNames,taskPriorityDefaults} from '../rules/task-policy.ts';
import {runTaskNotifications} from './task-notifications.ts';
import {z} from 'zod';
import {assertAdmin} from './credentials.ts';
import {command,expectedVersion,requestId,type Source} from './commands.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';
import {pushCandidates,pushStage,preferenceMatchesSql,type PushableTaskKind} from '../rules/task-preferences.ts';
import {TagState,type TagLabel} from './tag-state.ts';
import {isMemberArchive,archiveDisplayStatus,archivePath} from '../rules/archive-states.ts';
import {taskDeliveryReady} from '../rules/task-delivery.ts';
import {Archives} from './archives.ts';
import {auditCancellationTarget,planArchiveEffects} from '../rules/archive-lifecycle.ts';

const systemInitiator={kind:'system' as const,key:'zaoji-hr',name:'早纪（人事版）',avatar_key:'zaoji-hr'};
export const workTaskCommentReferenceInput=z.object({observation_id:z.uuid(),content_version:z.number().int().min(1)}).strict();
const monthlyKeyInput=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/,'月份必须使用 YYYY-MM 格式');
export const workTaskCreateInput=z.object({archive_id:z.uuid().nullable().default(null),kind:z.enum(taskKinds),labels:z.array(z.string().trim().min(1).max(80)).max(8).default([]),priority:z.enum(taskPriorities).optional(),title:z.string().trim().min(1).max(160),purpose:z.string().trim().min(1).max(4000),delivery:z.string().trim().min(1).max(4000),deadline_at:z.string().datetime(),source:z.enum(['manual','rule']).default('manual'),period_key:monthlyKeyInput.optional(),request_id:requestId}).strict();
export const workTaskClaimInput=z.object({id:z.uuid(),expected_version:expectedVersion,request_id:requestId}).strict();
export const workTaskAssignInput=z.object({id:z.uuid(),member_id:z.uuid(),expected_version:expectedVersion,reason:z.string().trim().min(1).max(500),request_id:requestId}).strict();
export const workTaskCompleteInput=z.object({id:z.uuid(),expected_version:expectedVersion,result_kind:z.enum(['completed','continue','not_suitable','unable_to_contact','joined','discarded']),result_text:z.string().trim().min(1).max(5000),references:z.array(workTaskCommentReferenceInput).max(20).default([]),request_id:requestId}).strict();
export const workTaskReleaseInput=z.object({id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),reason:z.string().trim().max(500).default('主动交还，重新等待接取'),request_id:requestId}).strict();
export const workTaskCancelInput=z.object({id:z.uuid(),expected_version:expectedVersion,reason:z.string().trim().min(1).max(500),request_id:requestId}).strict();
export const workTaskExtendInput=z.object({id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),reason:z.string().trim().max(500).default('延期任务期限'),request_id:requestId}).strict();
export const workTaskEditInput=z.object({id:z.uuid(),expected_version:expectedVersion,title:z.string().trim().min(1).max(160).optional(),purpose:z.string().trim().min(1).max(4000).optional(),delivery:z.string().trim().min(1).max(4000).optional(),labels:z.array(z.string().trim().min(1).max(80)).max(8).optional(),priority:z.enum(taskPriorities).optional(),deadline_at:z.string().datetime().optional(),request_id:requestId}).strict().refine(a=>a.title!==undefined||a.purpose!==undefined||a.delivery!==undefined||a.labels!==undefined||a.priority!==undefined||a.deadline_at!==undefined,{message:'至少需要调整一项任务内容'});
export const workTaskReopenInput=z.object({id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),owner_mode:z.enum(['keep','unassigned']).default('keep'),reason:z.string().trim().max(500).default('重新开启任务'),request_id:requestId}).strict();
export const workTaskCommentCreateInput=z.object({task_id:z.uuid(),body:z.string().trim().min(1).max(5000),references:z.array(workTaskCommentReferenceInput).max(20).default([]),request_id:requestId}).strict();
export const workTaskCommentEditInput=z.object({id:z.uuid(),expected_version:expectedVersion,body:z.string().trim().min(1).max(5000),references:z.array(workTaskCommentReferenceInput).max(20).optional(),request_id:requestId}).strict();
export const workTaskCommentDeleteInput=z.object({id:z.uuid(),expected_version:expectedVersion,request_id:requestId}).strict();
export const workTaskCommentRestoreInput=z.object({id:z.uuid(),expected_version:expectedVersion,request_id:requestId}).strict();
export const workTaskReferInput=z.object({archive_id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),request_id:requestId}).strict();
export const workTaskMembershipInput=z.object({archive_id:z.uuid(),expected_version:expectedVersion,deadline_at:z.string().datetime(),request_id:requestId}).strict();
type Row={id:string;archive_id:string|null;kind:typeof taskKinds[number];labels_json:string;priority:typeof taskPriorities[number];initiator_kind:'member'|'system';initiator_id:string|null;title:string;purpose:string;delivery:string;source:'manual'|'rule';status:'open'|'completed'|'expired'|'cancelled';owner_id:string|null;deadline_at:string;created_by:string;created_at:string;updated_at:string;version:number;result_kind:string|null;result_text:string|null;result_references_json:string;completed_at:string|null;closed_reason:string|null;period_key:string|null};
type CommentRow={id:string;task_id:string;author_id:string;author_name:string|null;body:string;references_json:string;created_at:string;updated_at:string;deleted_at:string|null;version:number};
type CommentVersionRow={comment_id:string;task_id:string;version:number;actor_id:string|null;source:'web'|'mcp'|'system';body:string;references_json:string;deleted_at:string|null;created_at:string};

export class WorkTasks {
  constructor(private env:Env,private actor:Actor,private source:Source){ }
  private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
  private event(task:string,kind:string,before:unknown,after:unknown,reason?:string){return this.stmt('INSERT INTO work_task_events(id,task_id,actor_id,source,kind,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),task,this.actor.id,this.source,kind,before?JSON.stringify(before):null,after?JSON.stringify(after):null,reason??null,now());}
  private async get(id:string,version?:number){const row=await this.stmt('SELECT * FROM work_tasks WHERE id=?',id).first<Row>();if(!row)throw new Failure(404,'NOT_FOUND','工作任务不存在');if(version!==undefined&&row.version!==version)throw new Failure(409,'VERSION_CONFLICT','工作任务已被更新，请刷新后重试');return row;}
  private assertOpenTask(task:Row){if(task.status!=='open')throw new Failure(409,'TASK_NOT_OPEN','只可操作开放中的任务');}
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
    if(!task.archive_id)throw new Failure(400,'TASK_ARCHIVE_REQUIRED','未关联档案的任务不能引用观察');
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
    const versionRows=await this.stmt('SELECT * FROM work_task_comment_versions WHERE task_id=? ORDER BY comment_id,version',task.id).all<CommentVersionRow>();
    const versionsByComment=new Map<string,CommentVersionRow[]>();for(const version of versionRows.results){const list=versionsByComment.get(version.comment_id)??[];list.push(version);versionsByComment.set(version.comment_id,list);}
    const result=[];
    for(const row of rows.results){
      const refs=JSON.parse(row.references_json||'[]') as {observation_id:string;content_version:number}[];
      const visible=[];for(const reference of refs){const current=await this.visibleReference(task,reference);if(current)visible.push(current);}
      const canSeeDeleted=!row.deleted_at||row.author_id===this.actor.id||this.actor.role==='admin';
      const history=[];for(const version of versionsByComment.get(row.id)??[]){
        const versionRefs=JSON.parse(version.references_json||'[]') as {observation_id:string;content_version:number}[],visibleVersionRefs=[];
        for(const reference of versionRefs){const current=await this.visibleReference(task,reference);if(current)visibleVersionRefs.push(current);}
        history.push({version:version.version,body:canSeeDeleted?version.body:null,deleted:!!version.deleted_at,deleted_at:version.deleted_at,references:visibleVersionRefs,references_restricted:visibleVersionRefs.length!==versionRefs.length,actor_id:version.actor_id,source:version.source,created_at:version.created_at});
      }
      result.push({id:row.id,task_id:row.task_id,author_id:row.author_id,author_name:row.author_name,body:canSeeDeleted?row.body:null,references:visible,references_restricted:visible.length!==refs.length,history,created_at:row.created_at,updated_at:row.updated_at,deleted:!!row.deleted_at,deleted_at:row.deleted_at,version:row.version});
    }
    return result;
  }
  async create(input:unknown){
    const a=workTaskCreateInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.create',parameters:{archive_id:a.archive_id,kind:a.kind,labels:a.labels,priority:a.priority,title:a.title,purpose:a.purpose,delivery:a.delivery,deadline_at:a.deadline_at,source:a.source,period_key:a.period_key}},async()=>{
      if(a.deadline_at<=now())throw new Failure(400,'DEADLINE_REQUIRED','开启任务必须有未来期限');
      if(a.kind==='monthly')throw new Failure(400,'MONTHLY_GENERATION_REMOVED','旧月度任务生成已移除，请创建普通跟进任务');
      if(a.archive_id){const archive=await this.stmt('SELECT closed,deleted,status FROM archives WHERE id=?',a.archive_id).first<{closed:number;deleted:number;status:string}>();if(!archive)throw new Failure(404,'ARCHIVE_NOT_FOUND','关联档案不存在');if(archive.deleted)throw new Failure(404,'ARCHIVE_NOT_FOUND','Linked archive is unavailable');if(archive.closed)throw new Failure(409,'ARCHIVE_CLOSED','关闭档案不能创建工作任务');}
      const id=uid(),at=now(),labels=a.labels.length?a.labels:[a.kind],priority=a.priority??taskPriorityDefaults[a.kind],result={id,archive_id:a.archive_id,kind:a.kind,labels_json:JSON.stringify(labels),labels,priority,initiator_kind:'member' as const,initiator_id:this.actor.id,title:a.title,purpose:a.purpose,delivery:a.delivery,source:a.source,status:'open' as const,owner_id:null,deadline_at:a.deadline_at,period_key:a.period_key??null,created_by:this.actor.id,created_at:at,updated_at:at,version:1,result_kind:null,result_text:null,result_references_json:'[]',completed_at:null,closed_reason:null,changed:true,reused:false};
      return {result,statements:[this.stmt('INSERT INTO work_tasks(id,archive_id,kind,labels_json,priority,initiator_kind,initiator_id,title,purpose,delivery,source,status,deadline_at,created_by,created_at,updated_at,period_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,a.archive_id,a.kind,JSON.stringify(labels),priority,'member',this.actor.id,a.title,a.purpose,a.delivery,a.source,'open',a.deadline_at,this.actor.id,at,at,a.period_key??null),this.event(id,'task.created',null,result)]};
    });
  }
  async list(input:unknown={}){
    const a=z.object({scope:z.enum(['all','recommended','mine','admin']).default('all'),state:z.enum(['open','closed','all']).default('open'),archive_id:z.uuid().optional(),query:z.string().trim().max(200).default(''),offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(50)}).parse(input);
    if(a.scope==='admin')assertAdmin(this.actor);
    const where=a.state==='open'?["t.status='open'"]:a.state==='closed'?["t.status<>'open'"]:[],args:unknown[]=[];where.push('(t.archive_id IS NULL OR ar.id IS NOT NULL)');
    if(a.archive_id){where.push('t.archive_id=?');args.push(a.archive_id);}
    if(a.query){
      // Literal substring matching before LIMIT; wildcard characters stay literal.
      where.push("(instr(lower(t.title),lower(?))>0 OR instr(lower(t.purpose),lower(?))>0 OR instr(lower(t.delivery),lower(?))>0 OR instr(lower(ar.name),lower(?))>0)");
      args.push(a.query,a.query,a.query,a.query);
    }
    if(a.scope==='mine') {where.push('t.owner_id=?');args.push(this.actor.id);}
    if(a.scope==='recommended') {where.push(`(${preferenceMatchesSql('?')} AND t.owner_id IS NULL)`);args.push(this.actor.id);}
    const rows=await this.stmt(`SELECT t.*,
      CASE WHEN t.status='open' THEN NULL ELSE COALESCE(
        (SELECT max(e.created_at) FROM work_task_events e WHERE e.task_id=t.id AND e.kind IN ('task.completed','task.cancelled','task.expired','completed','cancelled','expired')),
        t.completed_at
      ) END closed_at,
      (SELECT name FROM members WHERE id=t.owner_id) owner_name,
      (SELECT version FROM members WHERE id=t.owner_id) owner_version,
      (SELECT name FROM members WHERE id=t.initiator_id) initiator_name,
      (SELECT version FROM members WHERE id=t.initiator_id) initiator_version,
      ar.type archive_type,
      ar.name archive_name,
      ar.status archive_status,
      ar.person_role archive_person_role,
      ar.member_status archive_member_status,
      ar.closed archive_closed,
      ar.deleted archive_deleted,
      ar.version archive_version,
      ar.updated_at archive_updated_at,
      (SELECT count(*) FROM observations o WHERE o.archive_id=ar.id AND o.deleted=0) archive_observation_count,
      (SELECT substr(v.body,1,240) FROM observations o JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version WHERE o.archive_id=ar.id AND o.deleted=0 ORDER BY o.updated_at DESC,o.id DESC LIMIT 1) archive_latest_observation,
      (SELECT json_group_array(json_object('id',m.id,'name',m.name,'frozen',m.frozen)) FROM archive_bindings b JOIN members m ON m.id=b.member_id WHERE b.archive_id=ar.id AND b.status=ar.status) archive_members_json
      FROM work_tasks t
      LEFT JOIN archives ar ON ar.id=t.archive_id AND (ar.deleted=0 OR ?='admin')
      WHERE ${where.join(' AND ')} ORDER BY t.deadline_at,t.created_at,t.id LIMIT ? OFFSET ?`,this.actor.role,...args,a.limit+1,a.offset).all();
    const next_offset=rows.results.length>a.limit?a.offset+a.limit:null;
    const tasks=rows.results.slice(0,a.limit) as (Record<string,unknown>&{archive_id:string|null;archive_members_json?:string|null})[];
    const archiveIds=[...new Set(tasks.map(task=>task.archive_id).filter((id):id is string=>!!id))];
    const tagSummaries=archiveIds.length?await new TagState(this.env,this.actor).summaries(archiveIds):new Map<string,{tags:TagLabel[];total:number}>();
    for(const task of tasks){
      const labelKeys=JSON.parse(String(task.labels_json??'[]')) as string[];
      task.label_keys=labelKeys;
      task.labels=labelKeys.map(key=>(taskLabelNames as Record<string,string>)[key]??key);
      task.overdue=taskOverdue({status:String(task.status),deadline_at:String(task.deadline_at)},now());
      task.initiator_name=task.initiator_kind==='system'?systemInitiator.name:(task.initiator_name??'未知发起人');
      task.initiator_avatar_key=task.initiator_kind==='system'?systemInitiator.avatar_key:null;
      const resultRefs=JSON.parse(String(task.result_references_json??'[]')) as {observation_id:string;content_version:number}[],visibleResultRefs=[];for(const reference of resultRefs){const current=await this.visibleReference(task as unknown as Row,reference);if(current)visibleResultRefs.push(current);}task.result_references=visibleResultRefs;task.result_references_restricted=visibleResultRefs.length!==resultRefs.length;delete task.result_references_json;
      const subject={type:String(task.archive_type),status:String(task.archive_status),person_role:task.archive_person_role as 'external'|'member'|null,member_status:task.archive_member_status as '可接工作'|'请假'|'失联'|null,closed:!!task.archive_closed,deleted:!!task.archive_deleted};
      task.ready_to_submit=taskDeliveryReady({status:task.status,kind:task.kind,owner_id:task.owner_id,source:task.source},task.archive_id?subject:null);
      if(task.archive_id&&task.archive_name){
        task.archive_preview={
          id:task.archive_id,
          type:task.archive_type,
          name:task.archive_name,
          status:archiveDisplayStatus(subject),
          personnel_status:subject.status,
          person_role:isMemberArchive(subject)?'member':'external',
          url:`${this.env.APP_ORIGIN}${archivePath(subject)}?archive=${task.archive_id}`,
          version:task.archive_version,
          updated_at:task.archive_updated_at,
          observation_count:task.archive_observation_count??0,
          latest_observation:task.archive_latest_observation??null,
          members:JSON.parse(task.archive_members_json??'[]'),
          tag_summary:tagSummaries.get(task.archive_id)??{tags:[],total:0},
        };
      }
      for(const key of ['archive_person_role','archive_member_status','archive_closed','archive_deleted'])delete task[key];
      delete task.archive_members_json;
      delete task.archive_type;
      delete task.archive_name;
      delete task.archive_status;
      delete task.archive_version;
      delete task.archive_updated_at;
      delete task.archive_observation_count;
      delete task.archive_latest_observation;
      delete task.labels_json;
    }
    if(a.scope==='admin') for(const task of tasks){const candidates=await this.candidates(task as unknown as Row);task.candidate_count=candidates.length;task.push_stage=pushStage(this.pushable(task as unknown as Row),now());}
    return {tasks,next_offset};
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
        const task=await this.get(a.id,a.expected_version);this.assertOpenTask(task);if(task.owner_id)throw new Failure(409,'TASK_ALREADY_CLAIMED','任务已经有人领取');
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
      const task=await this.get(a.id,a.expected_version);this.assertOpenTask(task);if(task.owner_id!==this.actor.id)throw new Failure(403,'TASK_OWNER_REQUIRED','只有当前负责人可以提交完成结果');await this.validateReferences(task,a.references);
      const key=uid(),at=now(),result={id:a.id,status:'completed',result_kind:a.result_kind,result_text:a.result_text,references:a.references,version:task.version+1,changed:true},refGuard=this.referenceGuard(key+':references',task,a.references);
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status='open' AND owner_id=?) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id),...(refGuard?[refGuard]:[]),this.stmt("UPDATE work_tasks SET status='completed',result_kind=?,result_text=?,result_references_json=?,completed_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='open' AND owner_id=?",a.result_kind,a.result_text,JSON.stringify(a.references),at,at,a.id,a.expected_version,this.actor.id),this.event(a.id,'task.completed',{status:task.status,owner_id:task.owner_id,version:task.version},{status:'completed',owner_id:task.owner_id,result_kind:a.result_kind,result_text:a.result_text,reference_count:a.references.length,version:task.version+1}),this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key,key+':references')]};
    });
  }
  async release(input:unknown){
    const a=workTaskReleaseInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.release',parameters:{id:a.id,expected_version:a.expected_version,deadline_at:a.deadline_at,reason:a.reason}},async()=>{
      const task=await this.get(a.id,a.expected_version);this.assertOpenTask(task);if(task.owner_id!==this.actor.id)throw new Failure(403,'TASK_OWNER_REQUIRED','只有当前负责人可以主动交还任务');if(a.deadline_at<=now())throw new Failure(400,'DEADLINE_REQUIRED','重新等待接取必须有未来期限');
      const key=uid(),at=now(),result={id:a.id,status:'open',owner_id:null,deadline_at:a.deadline_at,version:task.version+1,changed:true};
      return {result,statements:[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status=\'open\' AND owner_id=?) THEN 1 ELSE 0 END)',key,a.id,a.expected_version,this.actor.id),this.stmt('UPDATE work_tasks SET owner_id=NULL,deadline_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=\'open\' AND owner_id=?',a.deadline_at,at,a.id,a.expected_version,this.actor.id),this.event(a.id,'task.released',{owner_id:task.owner_id,deadline_at:task.deadline_at,version:task.version},{owner_id:null,deadline_at:a.deadline_at,version:task.version+1},a.reason),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async cancel(input:unknown){
    const a=workTaskCancelInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.cancel',parameters:{id:a.id,expected_version:a.expected_version,reason:a.reason}},async()=>{
      const task=await this.get(a.id,a.expected_version);this.assertOpenTask(task);
      const creatorMayCancel=task.created_by===this.actor.id&&!task.owner_id,ownerMayCancel=task.owner_id===this.actor.id;if(this.actor.role!=='admin'&&!creatorMayCancel&&!ownerMayCancel)throw new Failure(403,'TASK_CANCEL_FORBIDDEN','只有创建者取消未接取任务，或管理员取消已接取任务');
      const key=uid(),at=now(),restoration=await this.restoreCancelledAudit(task,at),result={id:a.id,status:'cancelled',owner_id:task.owner_id,version:task.version+1,changed:true,...restoration.result};
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status='open') THEN 1 ELSE 0 END)",key,a.id,a.expected_version),this.stmt("UPDATE work_tasks SET status='cancelled',closed_reason=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='open'",a.reason,at,a.id,a.expected_version),this.event(a.id,'task.cancelled',{status:task.status,owner_id:task.owner_id,version:task.version},{status:'cancelled',owner_id:task.owner_id,version:task.version+1},a.reason),...restoration.statements,this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async edit(input:unknown){
    const a=workTaskEditInput.parse(input),admin=this.actor.role==='admin';
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.edit',parameters:{id:a.id,expected_version:a.expected_version,title:a.title,purpose:a.purpose,delivery:a.delivery,labels:a.labels,priority:a.priority,deadline_at:a.deadline_at},requireAdmin:admin},async()=>{
      const task=await this.get(a.id,a.expected_version);
      this.assertOpenTask(task);
      if(this.actor.role!=='admin'&&task.created_by!==this.actor.id&&task.owner_id!==this.actor.id)throw new Failure(403,'TASK_EDIT_FORBIDDEN','只有创建者或当前负责人可以维护任务内容');
      if(a.deadline_at!==undefined&&Date.parse(a.deadline_at)<=Date.now())throw new Failure(400,'DEADLINE_REQUIRED','截止时间必须仍在未来');
      const labelKeys=a.labels??JSON.parse(task.labels_json||'[]') as string[],nextPriority=a.priority??task.priority,key=uid(),at=now(),next={title:a.title??task.title,purpose:a.purpose??task.purpose,delivery:a.delivery??task.delivery,deadline_at:a.deadline_at??task.deadline_at,labels_json:JSON.stringify(labelKeys),priority:nextPriority},changed=next.title!==task.title||next.purpose!==task.purpose||next.delivery!==task.delivery||next.deadline_at!==task.deadline_at||next.labels_json!==task.labels_json||next.priority!==task.priority;
      if(!changed)return {result:{id:task.id,status:task.status,version:task.version,changed:false},statements:[]};
      const result={id:task.id,status:task.status,title:next.title,purpose:next.purpose,delivery:next.delivery,deadline_at:next.deadline_at,labels:labelKeys,priority:nextPriority,version:task.version+1,changed:true};
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks t WHERE t.id=? AND t.version=? AND t.status='open' AND (t.created_by=? OR t.owner_id=? OR EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.role='admin' AND m.frozen=0))) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id,this.actor.id,this.actor.id),this.stmt('UPDATE work_tasks SET title=?,purpose=?,delivery=?,deadline_at=?,labels_json=?,priority=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status=\'open\'',next.title,next.purpose,next.delivery,next.deadline_at,next.labels_json,next.priority,at,a.id,a.expected_version),this.event(a.id,'task.edited',{title:task.title,purpose:task.purpose,delivery:task.delivery,deadline_at:task.deadline_at,labels:JSON.parse(task.labels_json||'[]'),priority:task.priority,version:task.version},result),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async extend(input:unknown){
    const a=workTaskExtendInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.extend',parameters:{id:a.id,expected_version:a.expected_version,deadline_at:a.deadline_at,reason:a.reason}},async()=>{
      const task=await this.get(a.id,a.expected_version);this.assertOpenTask(task);if(task.owner_id!==this.actor.id)throw new Failure(403,'TASK_OWNER_REQUIRED','只有当前负责人可以延期任务');
      if(Date.parse(a.deadline_at)<=Date.now()||Date.parse(a.deadline_at)<=Date.parse(task.deadline_at))throw new Failure(400,'DEADLINE_REQUIRED','新的截止时间必须晚于原期限并且仍在未来');
      const key=uid(),at=now(),result={id:task.id,status:'open',deadline_at:a.deadline_at,version:task.version+1,changed:true};
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status='open' AND owner_id=?) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id),this.stmt("UPDATE work_tasks SET deadline_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND status='open' AND owner_id=?",a.deadline_at,at,a.id,a.expected_version,this.actor.id),this.event(a.id,'task.deadline_changed',{deadline_at:task.deadline_at,version:task.version},{deadline_at:a.deadline_at,version:task.version+1},a.reason),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async reopen(input:unknown){
    const a=workTaskReopenInput.parse(input),admin=this.actor.role==='admin';
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.reopen',parameters:{id:a.id,expected_version:a.expected_version,deadline_at:a.deadline_at,owner_mode:a.owner_mode,reason:a.reason},requireAdmin:admin&&a.owner_mode==='unassigned'},async()=>{
      const task=await this.get(a.id,a.expected_version);if(!['expired','cancelled'].includes(task.status))throw new Failure(409,'TASK_NOT_REOPENABLE','只有已过期或已取消的任务可以重新开启');
      if(task.archive_id){const archive=await this.stmt('SELECT closed,deleted FROM archives WHERE id=?',task.archive_id).first<{closed:number;deleted:number}>();if(!archive||archive.deleted)throw new Failure(404,'ARCHIVE_NOT_FOUND','关联档案不存在');if(archive.closed)throw new Failure(409,'ARCHIVE_CLOSED','请先重新开启关联档案');}
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
      const task=await this.get(a.task_id);this.assertOpenTask(task);await this.validateReferences(task,a.references);
      const id=uid(),at=now(),key=uid(),result={id,task_id:task.id,author_id:this.actor.id,body:a.body,references:a.references,version:1,changed:true};const refGuard=this.referenceGuard(key+':references',task,a.references);
      return {result,statements:[this.commentTaskGuard(key,task.id),...(refGuard?[refGuard]:[]),this.stmt('INSERT INTO work_task_comments(id,task_id,author_id,body,references_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',id,task.id,this.actor.id,a.body,JSON.stringify(a.references),at,at),this.stmt('INSERT INTO work_task_comment_versions(comment_id,task_id,version,actor_id,source,body,references_json,created_at) VALUES(?,?,?,?,?,?,?,?)',id,task.id,1,this.actor.id,this.source,a.body,JSON.stringify(a.references),at),this.event(task.id,'task.comment_created',{comment_id:id},{comment_id:id,version:1,reference_count:a.references.length}),this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key,key+':references')]};
    });
  }
  async editComment(input:unknown){
    const a=workTaskCommentEditInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.comment.edit',parameters:{id:a.id,expected_version:a.expected_version,body:a.body,references:a.references}},async()=>{
      const row=await this.stmt('SELECT * FROM work_task_comments WHERE id=?',a.id).first<CommentRow>();if(!row)throw new Failure(404,'NOT_FOUND','评论不存在');const task=await this.get(row.task_id);this.assertOpenTask(task);if(row.deleted_at)throw new Failure(409,'COMMENT_DELETED','已删除评论请先恢复');if(this.actor.role!=='admin'&&row.author_id!==this.actor.id)throw new Failure(403,'COMMENT_AUTHOR_REQUIRED','只有评论作者或管理员可以修改评论');if(row.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','评论已被更新，请刷新后重试');
      const oldReferences=JSON.parse(row.references_json||'[]') as {observation_id:string;content_version:number}[],hiddenReferences=[] as {observation_id:string;content_version:number}[];
      for(const reference of oldReferences)if(!await this.visibleReference(task,reference))hiddenReferences.push(reference);
      const requestedReferences=a.references??oldReferences.filter(reference=>!hiddenReferences.some(hidden=>hidden.observation_id===reference.observation_id&&hidden.content_version===reference.content_version));
      await this.validateReferences(task,requestedReferences);
      const references=[...new Map([...requestedReferences,...hiddenReferences].map(reference=>[`${reference.observation_id}:${reference.content_version}`,reference])).values()];
      const key=uid(),at=now(),result={id:row.id,task_id:row.task_id,body:a.body,references:requestedReferences,version:row.version+1,changed:true};const refGuard=this.referenceGuard(key+':references',task,requestedReferences);
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_task_comments c JOIN work_tasks t ON t.id=c.task_id WHERE c.id=? AND c.version=? AND c.deleted_at IS NULL AND t.status='open' AND (c.author_id=? OR EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.role='admin' AND m.frozen=0))) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id,this.actor.id),...(refGuard?[refGuard]:[]),this.stmt('UPDATE work_task_comments SET body=?,references_json=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL',a.body,JSON.stringify(references),at,a.id,a.expected_version),this.stmt('INSERT INTO work_task_comment_versions(comment_id,task_id,version,actor_id,source,body,references_json,created_at) VALUES(?,?,?,?,?,?,?,?)',row.id,task.id,row.version+1,this.actor.id,this.source,a.body,JSON.stringify(references),at),this.event(task.id,'task.comment_updated',{comment_id:row.id,version:row.version},{comment_id:row.id,version:row.version+1,reference_count:references.length}),this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key,key+':references')]};
    });
  }
  async deleteComment(input:unknown){
    const a=workTaskCommentDeleteInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.comment.delete',parameters:{id:a.id,expected_version:a.expected_version}},async()=>{
      const row=await this.stmt('SELECT * FROM work_task_comments WHERE id=?',a.id).first<CommentRow>();if(!row)throw new Failure(404,'NOT_FOUND','评论不存在');const task=await this.get(row.task_id);this.assertOpenTask(task);if(row.deleted_at)return {result:{id:row.id,task_id:row.task_id,deleted:true,version:row.version,changed:false},statements:[]};if(row.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','评论已被更新，请刷新后重试');if(this.actor.role!=='admin'&&row.author_id!==this.actor.id)throw new Failure(403,'COMMENT_AUTHOR_REQUIRED','只有评论作者或管理员可以删除评论');
      const key=uid(),at=now(),result={id:row.id,task_id:row.task_id,deleted:true,deleted_at:at,version:row.version+1,changed:true};
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_task_comments c JOIN work_tasks t ON t.id=c.task_id WHERE c.id=? AND c.version=? AND c.deleted_at IS NULL AND t.status='open' AND (c.author_id=? OR EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.role='admin' AND m.frozen=0))) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id,this.actor.id),this.stmt('UPDATE work_task_comments SET deleted_at=?,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL',at,at,a.id,a.expected_version),this.stmt('INSERT INTO work_task_comment_versions(comment_id,task_id,version,actor_id,source,body,references_json,deleted_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',row.id,task.id,row.version+1,this.actor.id,this.source,row.body,row.references_json,at,at),this.event(task.id,'task.comment_deleted',{comment_id:row.id,version:row.version},{comment_id:row.id,version:row.version+1}),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async restoreComment(input:unknown){
    const a=workTaskCommentRestoreInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.comment.restore',parameters:{id:a.id,expected_version:a.expected_version}},async()=>{
      const row=await this.stmt('SELECT * FROM work_task_comments WHERE id=?',a.id).first<CommentRow>();if(!row)throw new Failure(404,'NOT_FOUND','评论不存在');const task=await this.get(row.task_id);this.assertOpenTask(task);if(!row.deleted_at)return {result:{id:row.id,task_id:row.task_id,deleted:false,version:row.version,changed:false},statements:[]};if(row.version!==a.expected_version)throw new Failure(409,'VERSION_CONFLICT','评论已被更新，请刷新后重试');if(this.actor.role!=='admin'&&row.author_id!==this.actor.id)throw new Failure(403,'COMMENT_AUTHOR_REQUIRED','只有评论作者或管理员可以恢复评论');
      const key=uid(),at=now(),result={id:row.id,task_id:row.task_id,deleted:false,version:row.version+1,changed:true};
      return {result,statements:[this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_task_comments c JOIN work_tasks t ON t.id=c.task_id WHERE c.id=? AND c.version=? AND c.deleted_at IS NOT NULL AND t.status='open' AND (c.author_id=? OR EXISTS(SELECT 1 FROM members m WHERE m.id=? AND m.role='admin' AND m.frozen=0))) THEN 1 ELSE 0 END)",key,a.id,a.expected_version,this.actor.id,this.actor.id),this.stmt('UPDATE work_task_comments SET deleted_at=NULL,updated_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NOT NULL',at,a.id,a.expected_version),this.stmt('INSERT INTO work_task_comment_versions(comment_id,task_id,version,actor_id,source,body,references_json,deleted_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',row.id,task.id,row.version+1,this.actor.id,this.source,row.body,row.references_json,null,at),this.event(task.id,'task.comment_restored',{comment_id:row.id,version:row.version},{comment_id:row.id,version:row.version+1}),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
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
    const task=await this.get(id);const archive=task.archive_id?await new Archives(this.env,this.actor,this.source).get(task.archive_id):null;const resultRefs=JSON.parse(task.result_references_json??'[]') as {observation_id:string;content_version:number}[],visibleResultRefs=[];for(const reference of resultRefs){const current=await this.visibleReference(task,reference);if(current)visibleResultRefs.push(current);}const initiator=task.initiator_kind==='system'?systemInitiator:await this.stmt('SELECT name,version FROM members WHERE id=?',task.initiator_id).first<{name:string;version:number}>();const labelKeys=JSON.parse(task.labels_json??'[]') as string[];const safeTask={...task,ready_to_submit:taskDeliveryReady(task,archive),label_keys:labelKeys,labels:labelKeys.map(key=>(taskLabelNames as Record<string,string>)[key]??key),overdue:taskOverdue(task,now()),initiator_name:initiator?.name??'未知发起人',initiator_version:initiator&&'version' in initiator?initiator.version:null,initiator_avatar_key:task.initiator_kind==='system'?systemInitiator.avatar_key:null,result_references:visibleResultRefs,result_references_restricted:visibleResultRefs.length!==resultRefs.length};delete (safeTask as {result_references_json?:string;labels_json?:string}).result_references_json;delete (safeTask as {labels_json?:string}).labels_json;const events=await this.stmt('SELECT e.id,e.actor_id,(SELECT name FROM members WHERE id=e.actor_id) actor_name,e.source,e.kind,e.before_json,e.after_json,e.reason,e.created_at FROM work_task_events e WHERE e.task_id=? ORDER BY e.rowid DESC LIMIT 100',id).all<Record<string,unknown>>();return {task:safeTask,events:events.results,comments:await this.comments(task)};
  }
  async expire(at=now()){return runTaskNotifications(this.env,'overdue',at);}
  async refer(input:unknown){return this.personnelTransition(workTaskReferInput.parse(input),'人事审核');}
  async confirmMembership(input:unknown){return this.personnelTransition(workTaskMembershipInput.parse(input),'已加入待对接');}
  private async personnelTransition(a:z.infer<typeof workTaskReferInput>,status:'人事审核'|'已加入待对接'){
    const service=new Archives(this.env,this.actor,this.source);
    // setState owns request replay, version checks, state, task creation and history in one transaction.
    // No pre-read can turn a successful retry into a stale-version failure.
    const result=await service.setState({id:a.archive_id,expected_version:a.expected_version,status,member_ids:[],deadline_at:a.deadline_at,request_id:a.request_id});
    return {...result,id:result.task_id??result.id,task_id:result.task_id??null,archive_id:a.archive_id,archive_status:status,archive_version:result.version,status:result.task_id?'open':null,reused:result.reused??!result.changed};
  }
  async assign(input:unknown){
    assertAdmin(this.actor);const a=workTaskAssignInput.parse(input);
    return command(this.env,this.actor,{requestId:a.request_id,operation:'work_task.assign',parameters:{id:a.id,member_id:a.member_id,expected_version:a.expected_version,reason:a.reason},requireAdmin:true},async()=>{
      const task=await this.get(a.id,a.expected_version);this.assertOpenTask(task);
      const member=await this.stmt('SELECT id,frozen FROM members WHERE id=?',a.member_id).first<{id:string;frozen:number}>();if(!member||member.frozen)throw new Failure(409,'MEMBER_NOT_ELIGIBLE','只能指派给未冻结的成员');
      const key=uid(),at=now(),result={id:a.id,owner_id:a.member_id,status:'open',version:task.version+1,changed:true,assigned:true};
      return {result,statements:[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM work_tasks WHERE id=? AND version=? AND status=\'open\') THEN 1 ELSE 0 END)',key,a.id,a.expected_version),this.stmt('UPDATE work_tasks SET owner_id=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=\'open\'',a.member_id,at,a.id,a.expected_version),this.event(a.id,'task.assigned',{owner_id:task.owner_id,version:task.version},{owner_id:a.member_id,version:task.version+1},a.reason),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
    });
  }
  async duePushes(at=now()){return runTaskNotifications(this.env,'due',at);}
}
