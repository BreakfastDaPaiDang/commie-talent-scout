import {z} from 'zod';
import {canonical,hash,KnowledgeError,now,uid,type Identity} from './types.ts';

const requestId=z.uuid();
const content={title:z.string().trim().min(1).max(200),body:z.string().trim().min(1).max(60000),tags:z.array(z.string().trim().min(1).max(40)).max(20),source:z.string().max(2000).default('')};
export const schemas={
 list:z.object({scope:z.enum(['active','pending','drafts','discarded','all']).default('active'),search:z.string().trim().max(100).default(''),tag:z.string().max(40).default(''),offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(30)}).strict(),
 get:z.object({id:z.uuid()}).strict(),
 save:z.object({id:z.uuid().optional(),entry_id:z.uuid().optional(),expected_revision:z.number().int().positive().optional(),...content,request_id:requestId}).strict(),
 submit:z.object({id:z.uuid(),expected_revision:z.number().int().positive(),replace_proposal_id:z.uuid().optional(),reason:z.string().trim().max(2000).default(''),request_id:requestId}).strict(),
 close:z.object({entry_id:z.uuid(),reason:z.string().trim().min(1).max(2000),request_id:requestId}).strict(),
 endorse:z.object({proposal_id:z.uuid(),request_id:requestId}).strict(),
 tag:z.object({name:z.string().trim().min(1).max(40),request_id:requestId}).strict(),
 request:z.object({request_id:requestId}).strict(),
 effective:z.object({cursor:z.coerce.number().int().min(0).default(0),revision:z.coerce.number().int().min(0).optional(),limit:z.coerce.number().int().min(1).max(50).default(10)}).strict(),
};
type Entry={id:string;author_id:string;author_name:string;active_version_id:string|null;public_at:string|null;closed_at:string|null;revision:number;created_at:string};
type Version={id:string;entry_id:string;author_id:string;author_name:string;title:string;body:string;tags_json:string;source:string;base_version_id:string|null;state:'draft'|'submitted';revision:number;created_at:string;updated_at:string};
type Proposal={id:string;entry_id:string;version_id:string|null;base_version_id:string|null;kind:'publish'|'close';author_id:string;author_name:string;reason:string;status:'pending'|'accepted'|'expired'|'superseded';submitted_at:string;deadline_at:string;decided_at:string|null};
function presentVersion(v:Version){const {tags_json,...rest}=v;return {...rest,tags:JSON.parse(tags_json) as string[]};}
function proposalStatus(p:Proposal,at:string){return p.status==='pending'&&p.deadline_at<=at?'expired':p.status;}

export class Knowledge{
 constructor(readonly db:D1Database,readonly actor:Identity,readonly clock:()=>string=now){}
 stmt(sql:string,...params:unknown[]){return this.db.prepare(sql).bind(...params);}
 eligible(){if(!this.actor.eligible||!this.actor.membership_id)throw new KnowledgeError(403,'MEMBERSHIP_REQUIRED','此操作需要账号当前绑定正式社员档案');}
 async entry(id:string){const e=await this.stmt('SELECT * FROM kb_entries WHERE id=?',id).first<Entry>();if(!e||(!e.public_at&&e.author_id!==this.actor.id))throw new KnowledgeError(404,'NOT_FOUND','条目不存在或不可见');return e;}
 async version(id:string){const v=await this.stmt('SELECT * FROM kb_versions WHERE id=?',id).first<Version>();if(!v||(v.state==='draft'&&v.author_id!==this.actor.id))throw new KnowledgeError(404,'NOT_FOUND','版本不存在或不可见');await this.entry(v.entry_id);return v;}
 guard(e:Entry){const key=uid();return [this.stmt('INSERT INTO kb_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM kb_entries WHERE id=? AND revision=?) THEN 1 ELSE 0 END)',key,e.id,e.revision),this.stmt('DELETE FROM kb_guards WHERE id=?',key)];}
 event(entry:string,kind:string,detail:unknown,at:string){return this.stmt('INSERT INTO kb_events(entry_id,actor_id,kind,detail_json,created_at) VALUES(?,?,?,?,?)',entry,this.actor.id,kind,JSON.stringify(detail),at);}
 async receipt(id:string,inputHash?:string){
  const r=await this.stmt('SELECT input_hash,result_json FROM kb_requests WHERE actor_id=? AND request_id=?',this.actor.id,id).first<{input_hash:string;result_json:string}>();
  if(r&&inputHash&&r.input_hash!==inputHash)throw new KnowledgeError(409,'REQUEST_REUSED','此请求编号已用于其他内容，请核对操作');
  return r?JSON.parse(r.result_json) as Record<string,unknown>:null;
 }
 async command(id:string,input:unknown,build:(at:string)=>Promise<{statements:D1PreparedStatement[];result:Record<string,unknown>|{sql:string;params:unknown[]}}>){
  const fingerprint=await hash(canonical(input)),prior=await this.receipt(id,fingerprint);if(prior)return prior;
  const at=this.clock(),{statements,result}=await build(at);
  const sqlResult='sql' in result&&typeof result.sql==='string'&&Array.isArray(result.params);
  const save=sqlResult?this.stmt(`INSERT INTO kb_requests(actor_id,request_id,input_hash,result_json,created_at) SELECT ?,?,?,(${result.sql}),?`,this.actor.id,id,fingerprint,...result.params as unknown[],at):this.stmt('INSERT INTO kb_requests VALUES(?,?,?,?,?)',this.actor.id,id,fingerprint,JSON.stringify(result),at);
  try{await this.db.batch([...statements,save]);}catch(error){const committed=await this.receipt(id,fingerprint);if(committed)return committed;if(/constraint|immutable/i.test(String(error)))throw new KnowledgeError(409,'CONFLICT','内容或认可已变化，请刷新后使用原请求重试');throw error;}
  return (await this.receipt(id,fingerprint))!;
 }
 async tags(){return {tags:(await this.db.prepare('SELECT name FROM kb_tags ORDER BY name').all<{name:string}>()).results.map(t=>t.name)};}
 async createTag(input:unknown){const a=schemas.tag.parse(input);return this.command(a.request_id,{op:'tag',...a},async()=>({statements:[this.stmt('INSERT OR IGNORE INTO kb_tags VALUES(?)',a.name)],result:{name:a.name}}));}
 async save(input:unknown){
  const a=schemas.save.parse(input);return this.command(a.request_id,{op:'save',...a},async at=>{
   let e:Entry|undefined,v:Version|undefined;
   if(a.id){v=await this.version(a.id);e=await this.entry(v.entry_id);if(v.state!=='draft'||v.author_id!==this.actor.id)throw new KnowledgeError(403,'DRAFT_OWNER_REQUIRED','仅作者可以修改自己的草稿');if(a.expected_revision!==v.revision)throw new KnowledgeError(409,'CONFLICT','草稿已更新，请刷新');if(a.entry_id&&a.entry_id!==e.id)throw new KnowledgeError(400,'ENTRY_MISMATCH','草稿不能移到其他条目');}
   else if(a.entry_id)e=await this.entry(a.entry_id);
   if(e?.closed_at)throw new KnowledgeError(409,'ENTRY_CLOSED','条目已关闭');
   if(e?.public_at)this.eligible();
   const tags=[...new Set(a.tags)];const known=await this.tags();if(tags.some(t=>!known.tags.includes(t)))throw new KnowledgeError(400,'UNKNOWN_TAG','请先创建缺少的知识标签');
   const entryId=e?.id??uid(),id=v?.id??uid(),statements:D1PreparedStatement[]=[];
   if(e){const [check,clean]=this.guard(e);statements.push(check,clean);}
   else statements.push(this.stmt('INSERT INTO kb_entries(id,author_id,author_name,created_at) VALUES(?,?,?,?)',entryId,this.actor.id,this.actor.name,at));
   if(v)statements.push(this.stmt('UPDATE kb_versions SET title=?,body=?,tags_json=?,source=?,revision=revision+1,updated_at=? WHERE id=?',a.title,a.body,JSON.stringify(tags),a.source,at,id));
   else statements.push(this.stmt("INSERT INTO kb_versions(id,entry_id,author_id,author_name,title,body,tags_json,source,base_version_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?)",id,entryId,this.actor.id,this.actor.name,a.title,a.body,JSON.stringify(tags),a.source,e?.active_version_id??null,at,at));
   if(e)statements.push(this.stmt('UPDATE kb_entries SET revision=revision+1 WHERE id=?',entryId));
   // Private draft content and changes never enter public history.
   return {statements,result:{entry_id:entryId,id,revision:(v?.revision??0)+1,state:'draft'}};
  });
 }
 async submit(input:unknown){
  const a=schemas.submit.parse(input);return this.command(a.request_id,{op:'submit',...a},async at=>{
   const v=await this.version(a.id),e=await this.entry(v.entry_id);
   if(v.state!=='draft'||v.author_id!==this.actor.id)throw new KnowledgeError(403,'DRAFT_OWNER_REQUIRED','仅作者可以提交自己的草稿');
   if(e.public_at)this.eligible();
   if(v.revision!==a.expected_revision||v.base_version_id!==e.active_version_id||e.closed_at)throw new KnowledgeError(409,'CONFLICT','条目或草稿已变化，请依据最新生效版本重新起草');
   const [check,clean]=this.guard(e),id=uid(),deadline=new Date(Date.parse(at)+7*86400000).toISOString();const statements=[check];
   if(a.replace_proposal_id){const old=await this.stmt('SELECT * FROM kb_proposals WHERE id=?',a.replace_proposal_id).first<Proposal>();if(!old||old.entry_id!==e.id||old.author_id!==this.actor.id||old.kind!=='publish'||proposalStatus(old,at)!=='pending')throw new KnowledgeError(409,'INVALID_REPLACEMENT','只能替换本人尚在征求认可的同条目修订');statements.push(this.stmt("UPDATE kb_proposals SET status='superseded',decided_at=? WHERE id=?",at,old.id));}
   statements.push(this.stmt("UPDATE kb_versions SET state='submitted',updated_at=? WHERE id=?",at,v.id),this.stmt("INSERT INTO kb_proposals(id,entry_id,version_id,base_version_id,kind,author_id,author_name,reason,status,submitted_at,deadline_at) VALUES(?,?,?,?,'publish',?,?,?,'pending',?,?)",id,e.id,v.id,e.active_version_id,this.actor.id,this.actor.name,a.reason,at,deadline),this.stmt('UPDATE kb_entries SET public_at=coalesce(public_at,?),revision=revision+1 WHERE id=?',at,e.id),this.event(e.id,'proposal.submitted',{proposal_id:id,version_id:v.id,replaces:a.replace_proposal_id??null},at),clean);
   return {statements,result:{entry_id:e.id,proposal_id:id,version_id:v.id,status:'pending',votes:0,deadline_at:deadline}};
  });
 }
 async proposeClose(input:unknown){
  const a=schemas.close.parse(input);return this.command(a.request_id,{op:'close',...a},async at=>{
   const e=await this.entry(a.entry_id);if(!e.public_at||e.closed_at)throw new KnowledgeError(409,'NOT_OPEN','只能提议关闭公开且尚未关闭的条目');
   const existing=await this.stmt("SELECT id FROM kb_proposals WHERE entry_id=? AND kind='close' AND status='pending' AND deadline_at>? AND base_version_id IS ?",e.id,at,e.active_version_id).first();if(existing)throw new KnowledgeError(409,'CLOSE_PENDING','已有关闭提案，请查看并参与认可');
   const [check,clean]=this.guard(e),id=uid(),deadline=new Date(Date.parse(at)+7*86400000).toISOString();
   return {statements:[check,this.stmt("INSERT INTO kb_proposals(id,entry_id,base_version_id,kind,author_id,author_name,reason,status,submitted_at,deadline_at) VALUES(?,?,?,'close',?,?,?,'pending',?,?)",id,e.id,e.active_version_id,this.actor.id,this.actor.name,a.reason,at,deadline),this.stmt('UPDATE kb_entries SET revision=revision+1 WHERE id=?',e.id),this.event(e.id,'close.proposed',{proposal_id:id,reason:a.reason},at),clean],result:{entry_id:e.id,proposal_id:id,status:'pending',votes:0,deadline_at:deadline}};
  });
 }
 async endorse(input:unknown){
  const a=schemas.endorse.parse(input);this.eligible();
  return this.command(a.request_id,{op:'endorse',...a},async at=>{
   const p=await this.stmt('SELECT * FROM kb_proposals WHERE id=?',a.proposal_id).first<Proposal>();if(!p)throw new KnowledgeError(404,'NOT_FOUND','提案不存在');const e=await this.entry(p.entry_id);
   const already=await this.stmt('SELECT actor_id FROM kb_votes WHERE proposal_id=? AND actor_id=?',p.id,this.actor.id).first();
   if(already)return {statements:[],result:{entry_id:e.id,proposal_id:p.id,status:proposalStatus(p,at),already_endorsed:true}};
   if(proposalStatus(p,at)!=='pending'||e.closed_at||p.base_version_id!==e.active_version_id)throw new KnowledgeError(409,'PROPOSAL_ENDED','提案已到期、已处理或生效版本已变化');
   const [check,clean]=this.guard(e),proposalGuard=uid();
   const statements=[check,this.stmt("INSERT INTO kb_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM kb_proposals WHERE id=? AND status='pending' AND deadline_at>?) THEN 1 ELSE 0 END)",proposalGuard,p.id,at),this.stmt('INSERT INTO kb_votes VALUES(?,?,?,?,?,?)',p.id,this.actor.id,this.actor.name,this.actor.membership_id,this.actor.verified_at,at),this.stmt("UPDATE kb_proposals SET status='accepted',decided_at=? WHERE id=? AND (SELECT count(*) FROM kb_votes WHERE proposal_id=?)>=3",at,p.id,p.id),this.stmt('DELETE FROM kb_guards WHERE id=?',proposalGuard)];
   if(p.kind==='publish')statements.push(this.stmt("UPDATE kb_entries SET active_version_id=? WHERE id=? AND EXISTS(SELECT 1 FROM kb_proposals WHERE id=? AND status='accepted')",p.version_id,e.id,p.id));
   else statements.push(this.stmt("UPDATE kb_entries SET closed_at=? WHERE id=? AND EXISTS(SELECT 1 FROM kb_proposals WHERE id=? AND status='accepted')",at,e.id,p.id));
   statements.push(this.stmt("UPDATE kb_proposals SET status='superseded',decided_at=? WHERE entry_id=? AND status='pending' AND id<>? AND EXISTS(SELECT 1 FROM kb_proposals WHERE id=? AND status='accepted')",at,e.id,p.id,p.id),this.stmt("UPDATE kb_meta SET revision=revision+1 WHERE id=1 AND EXISTS(SELECT 1 FROM kb_proposals WHERE id=? AND status='accepted')",p.id),this.stmt('UPDATE kb_entries SET revision=revision+1 WHERE id=?',e.id),this.event(e.id,'proposal.endorsed',{proposal_id:p.id},at),this.stmt("INSERT INTO kb_events(entry_id,actor_id,kind,detail_json,created_at) SELECT ?,?,'proposal.accepted',?,? WHERE EXISTS(SELECT 1 FROM kb_proposals WHERE id=? AND status='accepted')",e.id,this.actor.id,JSON.stringify({proposal_id:p.id,kind:p.kind}),at,p.id),clean);
   return {statements,result:{sql:"SELECT json_object('entry_id',entry_id,'proposal_id',id,'status',status,'votes',(SELECT count(*) FROM kb_votes WHERE proposal_id=kb_proposals.id)) FROM kb_proposals WHERE id=?",params:[p.id]}};
  });
 }
 async get(input:unknown){
  const a=schemas.get.parse(input),e=await this.entry(a.id),at=this.clock();
  const versions=(await this.stmt("SELECT * FROM kb_versions WHERE entry_id=? AND (state='submitted' OR author_id=?) ORDER BY created_at,id",e.id,this.actor.id).all<Version>()).results.map(presentVersion);
  const proposals=(await this.stmt('SELECT * FROM kb_proposals WHERE entry_id=? ORDER BY submitted_at,id',e.id).all<Proposal>()).results.map(p=>({...p,status:proposalStatus(p,at)}));
  const votes=(await this.stmt('SELECT v.* FROM kb_votes v JOIN kb_proposals p ON p.id=v.proposal_id WHERE p.entry_id=? ORDER BY v.created_at,v.actor_id',e.id).all()).results;
  const events=(await this.stmt('SELECT seq,actor_id,kind,detail_json,created_at FROM kb_events WHERE entry_id=? ORDER BY seq',e.id).all()).results;
  return {entry:e,versions,proposals,votes,events};
 }
 async list(input:unknown){
  const q=schemas.list.parse(input),at=this.clock();
  // A member's private draft overrides the public display only in their own draft scope.
  const draft=q.scope==='drafts';
  const display=draft?"(SELECT id FROM kb_versions WHERE entry_id=e.id AND state='draft' AND author_id=? ORDER BY updated_at DESC,id LIMIT 1)":"coalesce(e.active_version_id,(SELECT version_id FROM kb_proposals WHERE entry_id=e.id AND kind='publish' ORDER BY submitted_at DESC,id LIMIT 1))";
  const where={active:'e.closed_at IS NULL AND e.active_version_id IS NOT NULL',pending:"e.closed_at IS NULL AND EXISTS(SELECT 1 FROM kb_proposals p WHERE p.entry_id=e.id AND p.status='pending' AND p.deadline_at>?)",drafts:'e.closed_at IS NULL',discarded:"e.closed_at IS NOT NULL OR (e.active_version_id IS NULL AND NOT EXISTS(SELECT 1 FROM kb_proposals p WHERE p.entry_id=e.id AND p.status='pending' AND p.deadline_at>?))",all:'1=1'}[q.scope];
  const args:unknown[]=[...(draft?[this.actor.id]:[]),...(q.scope==='pending'||q.scope==='discarded'?[at]:[]),'%'+q.search.replace(/[\\%_]/g,'\\$&')+'%','%'+q.search.replace(/[\\%_]/g,'\\$&')+'%',q.tag,q.tag,q.limit+1,q.offset];
  const rows=(await this.stmt(`SELECT e.*,v.id display_version_id,v.title,v.tags_json,CASE WHEN e.closed_at IS NOT NULL THEN 'discarded' WHEN e.active_version_id IS NOT NULL THEN 'active' ELSE 'unadopted' END state FROM kb_entries e JOIN kb_versions v ON v.id=${display} WHERE (${where}) ${draft?'':"AND e.public_at IS NOT NULL"} AND (v.title LIKE ? ESCAPE '\\' OR v.body LIKE ? ESCAPE '\\') AND (?='' OR EXISTS(SELECT 1 FROM json_each(v.tags_json) WHERE value=?)) ORDER BY e.created_at DESC,e.id LIMIT ? OFFSET ?`,...args).all<Record<string,unknown>>()).results;
  return {entries:rows.slice(0,q.limit).map(({tags_json,...r})=>({...r,tags:JSON.parse(String(tags_json))})),next_offset:rows.length>q.limit?q.offset+q.limit:null};
 }
 async effective(input:unknown){
  const q=schemas.effective.parse(input);
  const revision=Number((await this.db.prepare('SELECT revision FROM kb_meta WHERE id=1').first<{revision:number}>())!.revision);
  if(q.cursor&&!Number.isInteger(q.revision))throw new KnowledgeError(400,'REVISION_REQUIRED','续读必须携带首批知识库版本');
  if(q.revision!==undefined&&q.revision!==revision)throw new KnowledgeError(409,'KNOWLEDGE_CHANGED','知识库已更新，请从首批重新读取');
  const rows=(await this.stmt('SELECT v.* FROM kb_entries e JOIN kb_versions v ON v.id=e.active_version_id WHERE e.closed_at IS NULL ORDER BY e.id LIMIT ? OFFSET ?',q.limit+1,q.cursor).all<Version>()).results;
  const after=Number((await this.db.prepare('SELECT revision FROM kb_meta WHERE id=1').first<{revision:number}>())!.revision);
  if(after!==revision)throw new KnowledgeError(409,'KNOWLEDGE_CHANGED','知识库已更新，请从首批重新读取');
  return {revision,entries:rows.slice(0,q.limit).map(presentVersion),next_cursor:rows.length>q.limit?q.cursor+q.limit:null,complete:rows.length<=q.limit};
 }
 async changes(){return {revision:Number((await this.db.prepare('SELECT revision FROM kb_meta WHERE id=1').first<{revision:number}>())!.revision)};}
}

export async function expire(db:D1Database,at=now()){
 await db.batch([db.prepare("INSERT INTO kb_events(entry_id,actor_id,kind,detail_json,created_at) SELECT entry_id,'system','proposal.expired',json_object('proposal_id',id),? FROM kb_proposals WHERE status='pending' AND deadline_at<=?").bind(at,at),db.prepare("UPDATE kb_proposals SET status='expired',decided_at=? WHERE status='pending' AND deadline_at<=?").bind(at,at)]);
}
