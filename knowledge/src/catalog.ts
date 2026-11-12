import {z} from 'zod';
import {KnowledgeError,canonical,hash,now,uid,type Env,type Identity} from './types.ts';
import {resourcePurposes} from '../../app/shared/resources.ts';
import type {CatalogContent,CatalogEntry,CatalogGroup,CatalogIssue,CatalogGrant,CatalogPerson} from '../../app/shared/catalog.ts';

export type CatalogActor=Identity|{kind:'guest';id:string;name:string;eligible:false};
const uuid=z.uuid(),text=(max:number)=>z.string().trim().max(max),request={request_id:uuid};
export const contentSchema=z.object({
 name:text(120).min(1),kind:text(60).default(''),purposes:z.array(text(80).min(1)).max(30).default([]),capacity:z.number().int().min(0).max(100000).nullable().default(null),
 active:z.boolean().default(true),deleted:z.boolean().default(false),note:text(20000).default(''),group_id:uuid.nullable().default(null),owner_id:uuid.nullable().default(null),collaborator_ids:z.array(uuid).max(30).default([]),
 provider:text(1000).default(''),conditions:text(4000).default(''),contact:text(2000).default(''),requirements:text(5000).default(''),time_commitment:text(1000).default(''),support:text(4000).default(''),headcount:z.number().int().min(0).max(100000).nullable().default(null),attachment_ids:z.array(uuid).max(30).default([]),source:text(2000).default('')
}).strict();
export const groupSchema=z.object({name:text(120).min(1),description:text(3000).default(''),maintainer_ids:z.array(uuid).min(1).max(30)}).strict();
export const catalogSchemas={
 list:z.object({search:text(100).default(''),kind:z.enum(['all','resource','position']).default('all'),offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(50),include_deleted:z.union([z.boolean(),z.enum(['true','false'])]).default(false)}),
 publish:z.object({...request,id:uuid,record_kind:z.enum(['resource','position']),content:contentSchema}).strict(),
 group:z.object({...request,id:uuid,content:groupSchema}).strict(),
 issue:z.object({...request,id:uuid,target_type:z.enum(['entry','group']),target_id:uuid,base_version:z.number().int().positive(),title:text(200).min(1),body:text(15000).min(1),proposal:z.union([contentSchema,groupSchema]).nullable().default(null)}).strict(),
 comment:z.object({...request,issue_id:uuid,body:text(10000).min(1)}).strict(),
 resolve:z.object({...request,issue_id:uuid,expected_version:z.number().int().positive(),action:z.enum(['merge','close']),result:text(5000).min(1)}).strict(),
 grant:z.object({...request,id:uuid,entry_id:uuid,recipient_name:text(120).min(1),recipient_archive_id:uuid.nullable().default(null),receiver_id:uuid,note:text(3000).default('')}).strict(),
 grantAction:z.object({...request,id:uuid,expected_version:z.number().int().positive(),action:z.enum(['receive','revoke','rotate']),result:text(3000).min(1)}).strict(),
};
type Row=Record<string,unknown>;
const entry=(r:Row):CatalogEntry=>({...JSON.parse(String(r.content_json)),id:String(r.id),version:Number(r.version),record_kind:r.record_kind,published_at:r.published_at,updated_at:r.updated_at});
const group=(r:Row):CatalogGroup=>({...JSON.parse(String(r.content_json)),id:String(r.id),version:Number(r.version),updated_at:r.updated_at});
const issue=(r:Row):CatalogIssue=>{const {proposal_json,...rest}=r;return {...rest,proposal:proposal_json?JSON.parse(String(proposal_json)):null} as CatalogIssue;};
export const presentGrant=(r:Row):CatalogGrant=>{const {token_hash,...rest}=r;return rest as CatalogGrant;};

export class Catalog{
 constructor(readonly env:Env,readonly actor:CatalogActor,readonly directory:()=>Promise<CatalogPerson[]>,readonly clock=now){}
 stmt(sql:string,...args:unknown[]){return this.env.KNOWLEDGE_DB.prepare(sql).bind(...args);}
 get guest(){return 'kind' in this.actor&&this.actor.kind==='guest';}
 member(){if(this.guest||!this.actor.eligible)throw new KnowledgeError(403,'FORMAL_MEMBER_REQUIRED','此操作需要当前正式成员身份');}
 async ready(){if(!(await this.stmt('SELECT authority_ready FROM catalog_meta WHERE id=1').first<{authority_ready:number}>())?.authority_ready)throw new KnowledgeError(503,'CATALOG_PREPARING','资源目录正在准备，请稍后重试');}
 async readable(){await this.ready();if(this.guest){if(!await this.stmt('SELECT id FROM catalog_grants WHERE id=? AND revoked_at IS NULL',this.actor.id).first())throw new KnowledgeError(401,'GIFT_REVOKED','访问入口已撤销');}else this.member();}
 async receipt(requestId:string){return this.stmt('SELECT result_json FROM catalog_requests WHERE actor_id=? AND request_id=?',this.actor.id,requestId).first<{result_json:string}>().then(r=>r?JSON.parse(r.result_json):null);}
 async mutate<T>(operation:string,input:{request_id:string},prepare:()=>Promise<{statements:D1PreparedStatement[];result:T}>):Promise<T>{
  this.member();await this.ready();const fingerprint=await hash(canonical({operation,input})),prior=await this.stmt('SELECT * FROM catalog_requests WHERE actor_id=? AND request_id=?',this.actor.id,input.request_id).first<Row>();
  if(prior){if(prior.fingerprint!==fingerprint)throw new KnowledgeError(409,'REQUEST_REUSED','请求编号已用于其他内容');return JSON.parse(String(prior.result_json));}
  const prepared=await prepare();
  try{await this.env.KNOWLEDGE_DB.batch([...prepared.statements,this.stmt('INSERT INTO catalog_requests VALUES(?,?,?,?,?)',this.actor.id,input.request_id,fingerprint,JSON.stringify(prepared.result),this.clock()),this.stmt('UPDATE catalog_meta SET revision=revision+1 WHERE id=1')]);}
  catch(error){const saved=await this.stmt('SELECT * FROM catalog_requests WHERE actor_id=? AND request_id=?',this.actor.id,input.request_id).first<Row>();if(saved?.fingerprint===fingerprint)return JSON.parse(String(saved.result_json));if(saved)throw new KnowledgeError(409,'REQUEST_REUSED','请求编号已用于其他内容');throw new KnowledgeError(409,'CONCURRENT_CHANGE','内容或权限已变化，请重新查看后再提交');}
  return prepared.result;
 }
 guard(table:'catalog_entries'|'catalog_groups'|'catalog_issues'|'catalog_grants',id:string,version:number){const key=uid();return [this.stmt(`INSERT INTO kb_guards VALUES(?,CASE WHEN COALESCE((SELECT version FROM ${table} WHERE id=?),0)=? THEN 1 ELSE 0 END)`,key,id,version),this.stmt('DELETE FROM kb_guards WHERE id=?',key)];}
 version(type:'entry'|'group',id:string,version:number,content:unknown,issueId:string|null,at:string){return this.stmt('INSERT INTO catalog_versions VALUES(?,?,?,?,?,?,?,?)',type,id,version,JSON.stringify(content),this.actor.id,this.actor.name,issueId,at);}
 async participants(ids:string[]){const people=await this.directory();if(ids.some(id=>!people.some(p=>p.id===id)))throw new KnowledgeError(400,'MEMBER_UNAVAILABLE','维护者或接收负责人必须是当前可用的正式成员');return people;}
 async rawEntry(id:string){const row=await this.stmt('SELECT * FROM catalog_entries WHERE id=?',id).first<Row>();if(!row)throw new KnowledgeError(404,'NOT_FOUND','记录不存在');return row;}
 async rawTarget(type:'entry'|'group',id:string){const r=type==='entry'?await this.rawEntry(id):await this.stmt('SELECT * FROM catalog_groups WHERE id=?',id).first<Row>();if(!r)throw new KnowledgeError(404,'NOT_FOUND','记录不存在');return r;}
 async manages(type:'entry'|'group',r:Row){
  this.member();const data=JSON.parse(String(r.content_json));
  if(type==='group')return data.maintainer_ids.includes(this.actor.id);
  if(data.owner_id===this.actor.id||data.collaborator_ids.includes(this.actor.id))return true;
  if(!data.owner_id)return true; // Imported records explicitly await a first named maintainer.
  if(data.group_id){const g=await this.stmt('SELECT content_json FROM catalog_groups WHERE id=?',data.group_id).first<{content_json:string}>();if(g&&JSON.parse(g.content_json).maintainer_ids.includes(this.actor.id))return true;}
  return false;
 }
 async validateContent(raw:unknown,id:string,kind:'resource'|'position'){
  const data=contentSchema.parse(raw);data.purposes=resourcePurposes(data.purposes);data.collaborator_ids=[...new Set(data.collaborator_ids)];data.attachment_ids=[...new Set(data.attachment_ids)];
  if(!data.owner_id)throw new KnowledgeError(400,'OWNER_REQUIRED','请选择记录维护者');
  await this.participants([data.owner_id,...data.collaborator_ids]);
  if(data.group_id&&!await this.stmt('SELECT id FROM catalog_groups WHERE id=?',data.group_id).first())throw new KnowledgeError(400,'GROUP_NOT_FOUND','所选组不存在');
  if(kind==='position'&&(!data.group_id||!data.note||!data.time_commitment||!data.support||!data.contact))throw new KnowledgeError(400,'POSITION_INCOMPLETE','岗位需说明所属组、实际工作、投入要求、支持条件和对接方式；未知条件请写待协商');
  if(data.contact&&/^\w+:/.test(data.contact)&&!/^https?:\/\//i.test(data.contact))throw new KnowledgeError(400,'INVALID_CONTACT','联系入口请使用文字或 HTTP(S) 链接');
  for(const fileId of data.attachment_ids){const file=await this.stmt('SELECT * FROM catalog_files WHERE id=? AND state=\'ready\'',fileId).first<Row>();if(!file||!(file.entry_id===id||(!file.entry_id&&file.author_id===this.actor.id)))throw new KnowledgeError(400,'FILE_UNAVAILABLE','附件不存在、未上传完成或不属于此记录');}
  return data;
 }
 async list(input:unknown={}){
  await this.readable();const q=catalogSchemas.list.parse(input),deleted=q.include_deleted===true||q.include_deleted==='true';if(this.guest&&deleted)throw new KnowledgeError(403,'HISTORY_FORBIDDEN','当前入口仅能查看发布目录');
  const where=`${deleted?'1=1':'deleted=0'} AND (?='all' OR record_kind=?) AND instr(lower(name||' '||content_json),lower(?))>0`;
  const rows=await this.stmt(`SELECT * FROM catalog_entries WHERE ${where} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`,q.kind,q.kind,q.search,q.limit+1,q.offset).all<Row>();
  return {entries:rows.results.slice(0,q.limit).map(entry),next_offset:rows.results.length>q.limit?q.offset+q.limit:null,revision:(await this.stmt('SELECT revision FROM catalog_meta WHERE id=1').first<{revision:number}>())!.revision};
 }
 async allResources(){
  this.member();await this.ready();const rows=await this.stmt("SELECT * FROM catalog_entries WHERE record_kind='resource' ORDER BY name,id LIMIT 2001").all<Row>();if(rows.results.length>2000)throw new KnowledgeError(409,'RESOURCE_LIMIT','资源目录过大，无法完整读取');return {resources:rows.results.map(r=>{const e=entry(r);return {id:e.id,version:e.version,name:e.name,kind:e.kind,purposes:e.purposes,capacity:e.capacity,active:e.active,deleted:e.deleted,note:e.note};})};
 }
 async groups(){await this.readable();const rows=await this.stmt('SELECT * FROM catalog_groups ORDER BY name,id LIMIT 1001').all<Row>();if(rows.results.length>1000)throw new KnowledgeError(409,'GROUP_LIMIT','组目录过大');return {groups:rows.results.map(group)};}
 async get(id:string){
  await this.readable();const row=await this.rawEntry(uuid.parse(id)),data=entry(row);if(this.guest&&data.deleted)throw new KnowledgeError(404,'NOT_FOUND','记录不存在');
  const files=data.attachment_ids.length?(await this.stmt("SELECT id,name,mime,bytes,state,entry_id FROM catalog_files WHERE id IN (SELECT value FROM json_each(?)) AND state='ready'",JSON.stringify(data.attachment_ids)).all()).results:[];
  if(this.guest)return {entry:data,files,can_manage:false,versions:[],issues:[]};
  const versions=(await this.stmt("SELECT version,content_json,actor_name,issue_id,created_at FROM catalog_versions WHERE target_type='entry' AND target_id=? ORDER BY version DESC LIMIT 100",id).all<Row>()).results.map(({content_json,...v})=>({...v,content:JSON.parse(String(content_json))}));
  return {entry:data,files,can_manage:await this.manages('entry',row),versions,issues:(await this.stmt("SELECT * FROM catalog_issues WHERE target_type='entry' AND target_id=? ORDER BY created_at DESC,id LIMIT 100",id).all<Row>()).results.map(issue)};
 }
 async publish(input:unknown){const a=catalogSchemas.publish.parse(input);return this.mutate('publish',a,async()=>{
  const data=await this.validateContent({...a.content,owner_id:a.content.owner_id??this.actor.id},a.id,a.record_kind);if(data.deleted)throw new KnowledgeError(400,'INVALID_STATE','新记录不能以删除状态发布');
  if(await this.stmt('SELECT id FROM catalog_entries WHERE id=?',a.id).first())throw new KnowledgeError(409,'EXISTS','记录已存在，请通过 issue 提交修订');
  const at=this.clock(),[check,clean]=this.guard('catalog_entries',a.id,0);
  return {statements:[check,this.stmt('INSERT INTO catalog_entries VALUES(?,1,?,?,?,?,?,?,?,?,?)',a.id,a.record_kind,data.group_id,data.owner_id,data.name,+data.active,0,JSON.stringify(data),at,at),this.version('entry',a.id,1,data,null,at),...data.attachment_ids.map(id=>this.stmt('UPDATE catalog_files SET entry_id=? WHERE id=? AND entry_id IS NULL',a.id,id)),clean],result:{id:a.id,version:1,changed:true}};
 });}
 async createGroup(input:unknown){const a=catalogSchemas.group.parse(input);return this.mutate('group.create',a,async()=>{
  await this.participants(a.content.maintainer_ids);if(!a.content.maintainer_ids.includes(this.actor.id))throw new KnowledgeError(403,'GROUP_MAINTAINER_REQUIRED','创建组时请将自己列为维护者，后续通过 issue 交接');const at=this.clock(),[check,clean]=this.guard('catalog_groups',a.id,0);
  return {statements:[check,this.stmt('INSERT INTO catalog_groups VALUES(?,1,?,?,?,?)',a.id,a.content.name,JSON.stringify(a.content),at,at),this.version('group',a.id,1,a.content,null,at),clean],result:{id:a.id,version:1}};
 });}
 async submitIssue(input:unknown){const a=catalogSchemas.issue.parse(input);return this.mutate('issue.create',a,async()=>{
  const target=await this.rawTarget(a.target_type,a.target_id);if(target.version!==a.base_version)throw new KnowledgeError(409,'VERSION_CONFLICT','目标内容已更新，请基于当前版本提出修改');
  const proposed=a.proposal===null?null:a.target_type==='entry'?await this.validateContent(a.proposal,a.target_id,target.record_kind as 'resource'|'position'):groupSchema.parse(a.proposal);
  if(proposed&&a.target_type==='group')await this.participants((proposed as z.infer<typeof groupSchema>).maintainer_ids);
  const at=this.clock(),[check,clean]=this.guard(a.target_type==='entry'?'catalog_entries':'catalog_groups',a.target_id,a.base_version);
  return {statements:[check,this.stmt('INSERT INTO catalog_issues(id,target_type,target_id,base_version,title,body,proposal_json,author_id,author_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',a.id,a.target_type,a.target_id,a.base_version,a.title,a.body,proposed?JSON.stringify(proposed):null,this.actor.id,this.actor.name,at,at),clean],result:{id:a.id,version:1,state:'open'}};
 });}
 async issues(input:unknown={}){this.member();const q=z.object({state:z.enum(['all','open','merged','closed']).default('open'),offset:z.coerce.number().int().min(0).default(0),target_id:uuid.optional()}).parse(input);const rows=await this.stmt("SELECT * FROM catalog_issues WHERE (?='all' OR state=?) AND (? IS NULL OR target_id=?) ORDER BY created_at DESC,id LIMIT 51 OFFSET ?",q.state,q.state,q.target_id??null,q.target_id??null,q.offset).all<Row>();return {issues:rows.results.slice(0,50).map(issue),next_offset:rows.results.length>50?q.offset+50:null};}
 async issueDetail(id:string){this.member();const row=await this.stmt('SELECT * FROM catalog_issues WHERE id=?',uuid.parse(id)).first<Row>();if(!row)throw new KnowledgeError(404,'NOT_FOUND','issue 不存在');const target=await this.rawTarget(row.target_type as 'entry'|'group',String(row.target_id));return {issue:issue(row),target:row.target_type==='entry'?entry(target):group(target),can_manage:await this.manages(row.target_type as 'entry'|'group',target),comments:(await this.stmt('SELECT * FROM catalog_comments WHERE issue_id=? ORDER BY created_at,id LIMIT 500',id).all()).results};}
 async comment(input:unknown){const a=catalogSchemas.comment.parse(input);return this.mutate('issue.comment',a,async()=>{if(!await this.stmt('SELECT id FROM catalog_issues WHERE id=?',a.issue_id).first())throw new KnowledgeError(404,'NOT_FOUND','issue 不存在');const id=uid();return {statements:[this.stmt('INSERT INTO catalog_comments VALUES(?,?,?,?,?,?)',id,a.issue_id,this.actor.id,this.actor.name,a.body,this.clock())],result:{id}};});}
 async resolve(input:unknown){const a=catalogSchemas.resolve.parse(input);return this.mutate('issue.resolve',a,async()=>{
  const detail=await this.issueDetail(a.issue_id),i=detail.issue;if(!detail.can_manage)throw new KnowledgeError(403,'MAINTAINER_REQUIRED','由记录维护者处理此 issue');if(i.state!=='open'||i.version!==a.expected_version)throw new KnowledgeError(409,'ISSUE_CHANGED','issue 已处理或发生变化');
  const at=this.clock(),statements:D1PreparedStatement[]=[],[check,clean]=this.guard('catalog_issues',i.id,i.version);statements.push(check);
  if(a.action==='merge'){
   if(!i.proposal)throw new KnowledgeError(400,'PROPOSAL_REQUIRED','此 issue 没有具体修改，请记录处理结果后关闭，或另提修改建议');
   if(detail.target.version!==i.base_version)throw new KnowledgeError(409,'VERSION_CONFLICT','发布内容已有新版本，请重新提出修改，原 issue 保留');
   const type=i.target_type,table=type==='entry'?'catalog_entries':'catalog_groups',[guard,remove]=this.guard(table,i.target_id,i.base_version),version=i.base_version+1;statements.push(guard);
   if(type==='entry'){
    const data=await this.validateContent(i.proposal,i.target_id,(detail.target as CatalogEntry).record_kind);
    statements.push(this.stmt('UPDATE catalog_entries SET version=?,group_id=?,owner_id=?,name=?,active=?,deleted=?,content_json=?,updated_at=? WHERE id=?',version,data.group_id,data.owner_id,data.name,+data.active,+data.deleted,JSON.stringify(data),at,i.target_id),...data.attachment_ids.map(id=>this.stmt('UPDATE catalog_files SET entry_id=? WHERE id=? AND entry_id IS NULL',i.target_id,id)));
   }else{const data=groupSchema.parse(i.proposal);await this.participants(data.maintainer_ids);statements.push(this.stmt('UPDATE catalog_groups SET version=?,name=?,content_json=?,updated_at=? WHERE id=?',version,data.name,JSON.stringify(data),at,i.target_id));}
   statements.push(this.version(type,i.target_id,version,i.proposal,i.id,at),remove);
  }
  statements.push(this.stmt('UPDATE catalog_issues SET version=version+1,state=?,result=?,handled_by=?,updated_at=? WHERE id=?',a.action==='merge'?'merged':'closed',a.result,this.actor.id,at,i.id),clean);
  return {statements,result:{id:i.id,version:i.version+1,state:a.action==='merge'?'merged':'closed',target_version:a.action==='merge'?i.base_version+1:detail.target.version}};
 });}
 async grants(){await this.readable();const rows=await this.stmt(`SELECT * FROM catalog_grants ${this.guest?'WHERE id=?':''} ORDER BY created_at DESC,id LIMIT 1001`,...this.guest?[this.actor.id]:[]).all<Row>();if(rows.results.length>1000)throw new KnowledgeError(409,'GRANT_LIMIT','接收记录过多，请缩小范围');return {grants:rows.results.map(presentGrant)};}
 async give(input:unknown){const a=catalogSchemas.grant.parse(input);let freshKey:string|null=null;const result=await this.mutate('grant.create',a,async()=>{
  const e=entry(await this.rawEntry(a.entry_id));if(e.deleted||!e.active||e.record_kind!=='resource')throw new KnowledgeError(409,'RESOURCE_UNAVAILABLE','请选择当前可用资源');const people=await this.participants([a.receiver_id]),receiver=people.find(p=>p.id===a.receiver_id)!;
  freshKey='candy_'+uid().replaceAll('-','')+uid().replaceAll('-','');const tokenHash=await hash(freshKey),at=this.clock(),[check,clean]=this.guard('catalog_entries',e.id,e.version);
  return {statements:[check,this.stmt('INSERT INTO catalog_grants(id,entry_id,recipient_name,recipient_archive_id,receiver_id,receiver_name,issued_by,issuer_name,token_hash,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',a.id,e.id,a.recipient_name,a.recipient_archive_id,receiver.id,receiver.name,this.actor.id,this.actor.name,tokenHash,a.note,at,at),this.stmt('INSERT INTO catalog_grant_events VALUES(?,?,?,?,?,?)',uid(),a.id,this.actor.id,'issue','指定接收负责人并发放入口',at),clean],result:{id:a.id,version:1}};
 });if(freshKey&&(await this.stmt('SELECT token_hash FROM catalog_grants WHERE id=?',result.id).first<{token_hash:string}>())?.token_hash!==await hash(freshKey))freshKey=null;return {...result,access_key:freshKey};}
 async grantAction(input:unknown){const a=catalogSchemas.grantAction.parse(input);let freshKey:string|null=null;const result=await this.mutate('grant.'+a.action,a,async()=>{
  const row=await this.stmt('SELECT * FROM catalog_grants WHERE id=?',a.id).first<Row>();if(!row)throw new KnowledgeError(404,'NOT_FOUND','接收安排不存在');if(row.version!==a.expected_version||row.revoked_at)throw new KnowledgeError(409,'GRANT_CHANGED','接收安排已变化或入口已撤销');
  if(a.action==='receive'?(row.receiver_id!==this.actor.id||row.state!=='pending'):row.issued_by!==this.actor.id)throw new KnowledgeError(403,'GRANT_OWNER_REQUIRED',a.action==='receive'?'仅指定接收负责人可确认接收':'仅发放人可撤销或重新生成入口');
  const at=this.clock(),[check,clean]=this.guard('catalog_grants',a.id,a.expected_version),statements=[check];
  if(a.action==='receive')statements.push(this.stmt("UPDATE catalog_grants SET state='received',received_at=?,version=version+1,updated_at=? WHERE id=?",at,at,a.id));
  else if(a.action==='revoke')statements.push(this.stmt("UPDATE catalog_grants SET revoked_at=?,state=CASE WHEN state='pending' THEN 'cancelled' ELSE state END,version=version+1,updated_at=? WHERE id=?",at,at,a.id));
  else{freshKey='candy_'+uid().replaceAll('-','')+uid().replaceAll('-','');statements.push(this.stmt('UPDATE catalog_grants SET token_hash=?,version=version+1,updated_at=? WHERE id=?',await hash(freshKey),at,a.id));}
  statements.push(this.stmt('INSERT INTO catalog_grant_events VALUES(?,?,?,?,?,?)',uid(),a.id,this.actor.id,a.action,a.result,at),clean);return {statements,result:{id:a.id,version:a.expected_version+1}};
 });if(freshKey&&(await this.stmt('SELECT token_hash FROM catalog_grants WHERE id=?',result.id).first<{token_hash:string}>())?.token_hash!==await hash(freshKey))freshKey=null;return {...result,access_key:freshKey};}
}
