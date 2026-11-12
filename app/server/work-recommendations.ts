import {resourcePurposes} from '../shared/resources.ts';
import {Resources} from './resources.ts';
import {z} from 'zod';
import type {Source} from './commands.ts';
import {Archives} from './archives.ts';
import {evidenceVisibilitySql} from './tag-state.ts';
import {Failure,now,uid,type Env,type Actor} from './types.ts';
import {recommendFromObservation,type RecommendationData,type RecommendationEvidence,type RecommendationTarget} from '../shared/work-recommendations.ts';

export const handoffInput=z.object({observation_id:z.uuid(),content_version:z.number().int().positive(),target_kind:z.enum(['resource','person','task']),target_id:z.uuid(),target_version:z.number().int().positive(),target_fingerprint:z.string().regex(/^[a-f0-9]{64}$/),owner_id:z.uuid()}).strict();
export class WorkRecommendations{
 constructor(private env:Env,private actor:Actor,private source:Source='web'){}
 private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 private async rows<T>(sql:string,...args:unknown[]){const r=await this.stmt(sql+' LIMIT 2001',...args).all<T>();if(r.results.length>2000)throw new Failure(409,'RECOMMENDATION_LIMIT','候选范围过大，暂不能完整匹配');return r.results;}
 async read(input:unknown):Promise<RecommendationData>{
  const a=z.object({archive_id:z.uuid(),observation_id:z.uuid().optional()}).parse(input);
  const archive=await new Archives(this.env,this.actor,'web').get(a.archive_id,undefined,true);
  const evidence=await this.stmt(`SELECT o.id,o.content_version,v.body,o.created_at FROM observations o JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version WHERE o.archive_id=? AND o.deleted=0 ${a.observation_id?'AND o.id=?':''} ORDER BY o.created_at DESC,o.id DESC LIMIT 1`,...a.observation_id?[a.archive_id,a.observation_id]:[a.archive_id]).first<RecommendationEvidence>();
  if(a.observation_id&&!evidence)throw new Failure(409,'EVIDENCE_UNAVAILABLE','观察已删除或不属于此档案');
  const assignees=await this.rows<{id:string;name:string}>(`SELECT id,name FROM members WHERE frozen=0 AND identity_kind='human' ${this.actor.role==='admin'?'':'AND id=?'} ORDER BY name,id`,...this.actor.role==='admin'?[]:[this.actor.id]);
  const accepted=await this.rows<RecommendationData['accepted'][number]>(`SELECT l.task_id,t.title,t.status,m.name owner_name,t.result_text,l.target_name,l.target_kind,l.target_id,l.content_version,l.observation_id FROM work_recommendation_links l JOIN work_tasks t ON t.id=l.task_id JOIN observations o ON o.id=l.observation_id AND o.deleted=0 LEFT JOIN members m ON m.id=t.owner_id WHERE l.archive_id=? ORDER BY l.created_at DESC`,a.archive_id);
  if(!evidence)return {archive_version:archive.version,evidence:null,candidates:[],assignees,actor_id:this.actor.id,accepted};
  const resources=(await new Resources(this.env,this.actor).all()).filter(r=>r.active&&!r.deleted&&(r.capacity===null||r.capacity>0)).map(r=>({...r,purposes_json:JSON.stringify(r.purposes)}));
  // Match visible, active tag definitions, never infer availability from another person's needs.
  const people=await this.rows<{id:string;version:number;name:string;description:string}>(`SELECT a.id,a.version,a.name,group_concat(t.name||' '||t.description,'；') description FROM archives a JOIN archive_tags b ON b.archive_id=a.id JOIN tags t ON t.id=b.tag_id JOIN tag_categories c ON c.id=t.category_id WHERE a.type='person' AND a.closed=0 AND a.deleted=0 AND a.id<>? AND t.enabled=1 AND t.deleted=0 AND c.enabled=1 AND c.deleted=0 AND t.merged_into IS NULL AND ${evidenceVisibilitySql('b.evidence_json')} GROUP BY a.id ORDER BY a.name,a.id`,a.archive_id,this.actor.id,this.actor.role);
  const tasks=await this.rows<{id:string;version:number;title:string;purpose:string;delivery:string}>('SELECT t.id,t.version,t.title,t.purpose,t.delivery FROM work_tasks t LEFT JOIN archives a ON a.id=t.archive_id WHERE t.status=\'open\' AND t.owner_id IS NULL AND t.deadline_at>? AND (t.archive_id IS NULL OR (a.deleted=0 AND a.closed=0)) AND NOT EXISTS(SELECT 1 FROM work_recommendation_links l WHERE l.task_id=t.id) ORDER BY t.id',now());
  const targets:RecommendationTarget[]=[...resources.map(r=>({kind:'resource' as const,id:r.id,version:r.version,name:r.name,text:[r.kind,...resourcePurposes(JSON.parse(r.purposes_json)),r.note].join(' '),conditions:[r.capacity===null?'可接收人数待确认':`登记可接收 ${r.capacity} 人`,'需确认本人意愿和接收安排']})),...people.map(p=>({kind:'person' as const,id:p.id,version:p.version,name:p.name,text:p.description,conditions:['需确认对方是否愿意、能够提供帮助']})),...tasks.map(t=>({kind:'task' as const,id:t.id,version:t.version,name:t.title,text:t.purpose+'\n'+t.delivery,conditions:['未领取；需确认本人意愿和任务要求']}))];
  const candidates=await recommendFromObservation(evidence,targets);
  return {archive_version:archive.version,evidence,candidates,assignees,actor_id:this.actor.id,accepted};
 }
 async prepare(archiveId:string,h:z.infer<typeof handoffInput>){
  const data=await this.read({archive_id:archiveId,observation_id:h.observation_id});
  if(data.evidence?.content_version!==h.content_version)throw new Failure(409,'EVIDENCE_CHANGED','依据已修改，请重新查看推荐');
  const candidate=data.candidates.find(c=>c.kind===h.target_kind&&c.id===h.target_id);
  if(!candidate||candidate.version!==h.target_version||candidate.fingerprint!==h.target_fingerprint)throw new Failure(409,'RECOMMENDATION_CHANGED','候选已变更或不再可用，请刷新推荐');
  if(!data.assignees.some(m=>m.id===h.owner_id))throw new Failure(403,'ASSIGN_FORBIDDEN','只能由本人接下，或由管理员指派有效账号');
  const existing=await this.stmt('SELECT task_id FROM work_recommendation_links WHERE archive_id=? AND observation_id=? AND content_version=? AND target_kind=? AND target_id=?',archiveId,h.observation_id,h.content_version,h.target_kind,h.target_id).first<{task_id:string}>();
  const remoteResource=h.target_kind==='resource'&&await new Resources(this.env,this.actor).independent();
  return {existing,candidate,statements:(taskId:string)=>{
   const key=uid(),at=now(),table=h.target_kind==='resource'?'work_overview_resources':h.target_kind==='person'?'archives':'work_tasks';
   const condition=h.target_kind==='resource'?'active=1 AND deleted_at IS NULL AND (capacity IS NULL OR capacity>0)':h.target_kind==='person'?`deleted=0 AND closed=0 AND (SELECT group_concat(t.name||' '||t.description,'；') FROM archive_tags b JOIN tags t ON t.id=b.tag_id JOIN tag_categories c ON c.id=t.category_id WHERE b.archive_id=archives.id AND t.enabled=1 AND t.deleted=0 AND c.enabled=1 AND c.deleted=0 AND t.merged_into IS NULL AND ${evidenceVisibilitySql('b.evidence_json')})=?`:"status='open' AND owner_id IS NULL AND deadline_at>? AND (archive_id IS NULL OR EXISTS(SELECT 1 FROM archives a WHERE a.id=work_tasks.archive_id AND a.closed=0 AND a.deleted=0))";
   const reference=JSON.stringify([{observation_id:h.observation_id,content_version:h.content_version}]),commentId=uid(),body=`对接候选：${candidate.name}\n${candidate.reason}\n${candidate.conditions.join('；')}`;
   return [new Archives(this.env,this.actor,'web').guard(archiveId,data.archive_version,key+':archive'),this.stmt(`INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM observations WHERE id=? AND archive_id=? AND deleted=0 AND content_version=?) AND ${remoteResource?'1=1':`EXISTS(SELECT 1 FROM ${table} WHERE id=? AND version=? AND ${condition})`} AND EXISTS(SELECT 1 FROM members WHERE id=? AND frozen=0 AND identity_kind='human') AND EXISTS(SELECT 1 FROM members WHERE id=? AND (id=? OR role='admin')) THEN 1 ELSE 0 END)`,key,h.observation_id,archiveId,h.content_version,...(remoteResource?[]:[h.target_id,h.target_version,...(h.target_kind==='person'?[this.actor.id,this.actor.role,candidate.text]:h.target_kind==='task'?[at]:[])]),h.owner_id,this.actor.id,h.owner_id),
    this.stmt('UPDATE work_tasks SET owner_id=? WHERE id=?',h.owner_id,taskId),
    this.stmt('INSERT INTO work_overview_followups(task_id,archive_id) VALUES(?,?)',taskId,archiveId),
    this.stmt('INSERT INTO work_recommendation_links(task_id,archive_id,observation_id,content_version,target_kind,target_id,target_version,target_name,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',taskId,archiveId,h.observation_id,h.content_version,h.target_kind,h.target_id,h.target_version,candidate.name,candidate.reason,at),
    this.stmt("INSERT INTO work_task_events(id,task_id,actor_id,source,kind,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",uid(),taskId,this.actor.id,this.source,h.owner_id===this.actor.id?'task.claimed':'task.assigned',JSON.stringify({owner_id:h.owner_id}), '采纳对接推荐',at),
    this.stmt('INSERT INTO work_task_comments(id,task_id,author_id,body,references_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',commentId,taskId,this.actor.id,body,reference,at,at),
    this.stmt("INSERT INTO work_task_comment_versions(comment_id,task_id,version,actor_id,source,body,references_json,created_at) VALUES(?,?,1,?,?,?,?,?)",commentId,taskId,this.actor.id,this.source,body,reference,at),
    this.stmt('DELETE FROM mutation_guards WHERE id IN (?,?)',key,key+':archive')];
  }};
 }
}
