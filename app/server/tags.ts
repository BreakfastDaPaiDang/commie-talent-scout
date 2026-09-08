import {z} from 'zod';
import {Archives,archiveType} from './archives.ts';
import {command,requestId,expectedVersion,type Source} from './commands.ts';
import {TagState,evidenceInput,evidenceVisibilitySql,type TagBinding} from './tag-state.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';

const label=(max:number)=>z.string().trim().min(1).max(max).refine(v=>!/[：:\p{Cc}\p{Cf}]/u.test(v),'名称不能包含冒号、换行或控制字符');
export const tagColors=z.enum(['sage','blue','sand','lavender','slate','peach','teal']);
export const categoryCreateInput=z.object({type:archiveType,name:label(24),description:z.string().trim().max(160).default(''),color:tagColors.default('sage'),request_id:requestId}).strict();
export const tagCreateInput=z.object({category_id:z.uuid(),name:label(40),description:z.string().trim().min(1).max(160),request_id:requestId}).strict();
const changeInput=z.object({tag_id:z.uuid(),action:z.enum(['add','remove','evidence']),evidence:z.array(evidenceInput).max(30).optional()}).strict();
export const tagBatchInput=z.object({archive_id:z.uuid(),expected_version:expectedVersion,changes:z.array(changeInput).max(50).default([]),focus:z.array(z.uuid()).max(3).refine(x=>new Set(x).size===x.length,'重点不能重复').optional(),request_id:requestId}).strict().refine(x=>new Set(x.changes.map(c=>c.tag_id)).size===x.changes.length,'同批次每个标签只能操作一次');
export const tagListInput=z.object({type:archiveType,query:z.string().trim().max(200).default(''),category_id:z.uuid().optional(),include_disabled:z.boolean().default(false),before:z.string().max(100).optional(),limit:z.coerce.number().int().min(1).max(100).default(50)});
export function nameKey(name:string){return name.normalize('NFKC').toLowerCase().replace(/ß/g,'ss').replace(/ς/g,'σ');}
type Category={id:string;type:'person'|'org';name:string;description:string;color:string;version:number;enabled:number};
export type TagDefinition={id:string;category_id:string;category_name:string;category_version:number;category_enabled:number;type:'person'|'org';name:string;description:string;color:string;version:number;enabled:number;merged_into:string|null};
const definitionColumns='t.id,t.category_id,c.name category_name,c.version category_version,c.enabled category_enabled,c.type,t.name,t.description,c.color,t.version,t.enabled,t.merged_into';

export class Tags{
 readonly archives:Archives;readonly state:TagState;
 constructor(readonly env:Env,readonly actor:Actor,readonly source:Source){this.archives=new Archives(env,actor,source);this.state=new TagState(env,actor);}
 private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async definition(id:string){const row=await this.stmt(`SELECT ${definitionColumns} FROM tags t JOIN tag_categories c ON c.id=t.category_id WHERE t.id=?`,id).first<TagDefinition>();if(!row)throw new Failure(404,'NOT_FOUND','标签不存在');return row;}
 async categories(type:unknown){const t=archiveType.parse(type);return {categories:(await this.stmt('SELECT id,type,name,description,color,version,enabled FROM tag_categories WHERE type=? ORDER BY name_key,id',t).all<Category>()).results};}
 async list(input:unknown){
  const a=tagListInput.parse(input),where=['c.type=?'],args:unknown[]=[a.type];
  if(!a.include_disabled)where.push('t.enabled=1','c.enabled=1');
  if(a.category_id){where.push('c.id=?');args.push(a.category_id);}
  if(a.query){const q='%'+nameKey(a.query).replace(/[\\%_]/g,'\\$&')+'%';where.push("(t.name_key LIKE ? ESCAPE '\\' OR c.name_key LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\' OR (c.name_key||':'||t.name_key) LIKE ? ESCAPE '\\')");args.push(q,q,q,q,q);}
  if(a.before){where.push('t.id>?');args.push(a.before);}
  const rows=(await this.stmt(`SELECT ${definitionColumns},(SELECT count(*) FROM archive_tags b WHERE b.tag_id=t.id AND ${evidenceVisibilitySql('b.evidence_json')}) binding_count FROM tags t JOIN tag_categories c ON c.id=t.category_id WHERE ${where.join(' AND ')} ORDER BY t.id LIMIT ?`,this.actor.id,this.actor.role,...args,a.limit+1).all<TagDefinition&{binding_count:number}>()).results;
  const tags=rows.slice(0,a.limit);
  return {tags,next_cursor:rows.length>a.limit?tags.at(-1)!.id:null};
 }
 async count(tagId:string){
  return (await this.stmt(`SELECT count(*) count FROM archive_tags b WHERE b.tag_id=? AND ${evidenceVisibilitySql('b.evidence_json')}`,tagId,this.actor.id,this.actor.role).first<{count:number}>())!.count;
 }
 async createCategory(input:unknown){const a=categoryCreateInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'category.create',parameters:{...a,request_id:undefined}},async()=>{
  const old=await this.stmt('SELECT id,version FROM tag_categories WHERE type=? AND name_key=?',a.type,nameKey(a.name)).first<{id:string;version:number}>();
  if(old)return {result:{...old,changed:false,reused:true},statements:[]};
  const id=uid(),at=now(),definition={id,type:a.type,name:a.name,description:a.description,color:a.color,enabled:1,version:1};
  return {result:{id,version:1,changed:true,reused:false},statements:[this.stmt('INSERT INTO tag_categories(id,type,name,name_key,description,color,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,a.type,a.name,nameKey(a.name),a.description,a.color,this.actor.id,at,at),this.history('category',id,1,definition,at)]};
 });}
 async create(input:unknown){const a=tagCreateInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'tag.create',parameters:{...a,request_id:undefined}},async()=>{
  const c=await this.stmt('SELECT * FROM tag_categories WHERE id=?',a.category_id).first<Category>();if(!c)throw new Failure(404,'NOT_FOUND','类别不存在');
  const old=await this.stmt('SELECT id,version FROM tags WHERE category_id=? AND name_key=?',a.category_id,nameKey(a.name)).first<{id:string;version:number}>();if(old)return {result:{...old,changed:false,reused:true},statements:[]};
  if(!c.enabled)throw new Failure(409,'CATEGORY_DISABLED','该类别已停用，不能创建词条');
  const id=uid(),at=now(),key=uid(),definition={id,category_id:c.id,name:a.name,description:a.description,enabled:1,version:1,merged_into:null};
  return {result:{id,version:1,changed:true,reused:false},statements:[this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM tag_categories WHERE id=? AND enabled=1 AND version=?) THEN 1 ELSE 0 END)',key,c.id,c.version),this.stmt('INSERT INTO tags(id,category_id,name,name_key,description,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,c.id,a.name,nameKey(a.name),a.description,this.actor.id,at,at),this.history('tag',id,1,definition,at),this.stmt('DELETE FROM mutation_guards WHERE id=?',key)]};
 });}
 private history(type:string,id:string,version:number,definition:unknown,at:string){return this.stmt('INSERT INTO tag_definition_history(id,entity_type,version,definition_json,actor_id,created_at) VALUES(?,?,?,?,?,?)',id,type,version,JSON.stringify(definition),this.actor.id,at);}
 async bindings(id:string){const archive=await this.archives.get(id);return {archive_id:id,archive_url:this.archives.url(archive),version:archive.version,closed:archive.closed,tags:await this.state.list(id,archive.closed,archive.tag_snapshot_version)};}
 async batch(input:unknown){const a=tagBatchInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'archive.tags',parameters:{...a,request_id:undefined}},async()=>{
  const archive=await this.archives.get(a.archive_id,a.expected_version,true),before=await this.state.raw(a.archive_id),next=new Map(before.map(b=>[b.tag_id,b])),at=now(),key=uid(),guards:D1PreparedStatement[]=[],cleanup:D1PreparedStatement[]=[];
  for(const c of a.changes){
   const old=next.get(c.tag_id);
   const visibleOld=old?await this.state.visible(old):null;
   if(old&&!visibleOld)throw new Failure(403,'SOURCE_RESTRICTED','这个绑定的来源当前不可读，不能修改');
   if(old&&old.evidence.length){const visibilityKey=uid();guards.push(this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM json_each(?) e WHERE json_extract(e.value,'$.observation_id') IS NULL OR EXISTS(SELECT 1 FROM observations o WHERE o.id=json_extract(e.value,'$.observation_id') AND (o.deleted=0 OR o.author_id=? OR ?='admin'))) THEN 1 ELSE 0 END)",visibilityKey,JSON.stringify(old.evidence),this.actor.id,this.actor.role));cleanup.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',visibilityKey));}
   if(c.action==='remove'){next.delete(c.tag_id);continue;}
   if(c.action==='add'&&old)continue;
   if(c.action==='evidence'&&!old)throw new Failure(404,'BINDING_NOT_FOUND','请先确认该档案已经绑定此标签');
   const retainedRestricted=old&&visibleOld?old.evidence.filter(e=>!visibleOld.evidence.includes(e)):[];
   const evidence=[...(c.evidence??[]),...retainedRestricted];
   if((this.source==='mcp'||old?.evidence.length)&&!evidence.length)throw new Failure(400,'EVIDENCE_REQUIRED','Agent 绑定须提供记录/版本或明确独立材料；已有来源不能降级成无依据绑定');
   await this.state.validateEvidence(c.evidence??[],a.archive_id,this.source==='mcp');
   const t=await this.definition(c.tag_id);
   if(t.type!==archive.type)throw new Failure(400,'TAG_TYPE_MISMATCH','人物与组织不能跨库绑定');
   if(!old&&(!t.enabled||!t.category_enabled))throw new Failure(409,'TAG_DISABLED','停用标签或类别不能新增绑定');
   const guard=uid();guards.push(this.stmt('INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM tags t JOIN tag_categories c ON c.id=t.category_id WHERE t.id=? AND t.version=? AND c.version=? AND (?=1 OR (t.enabled=1 AND c.enabled=1))) THEN 1 ELSE 0 END)',guard,t.id,t.version,t.category_version,old?1:0));cleanup.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',guard));
   for(const e of c.evidence??[]){if(e.observation_id){const sourceKey=uid();guards.push(this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM observations WHERE id=? AND (deleted=0 OR author_id=? OR ?='admin')) THEN 1 ELSE 0 END)",sourceKey,e.observation_id,this.actor.id,this.actor.role));cleanup.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',sourceKey));}}
   if(old&&JSON.stringify(old.evidence)===JSON.stringify(evidence))continue;
   const b:TagBinding=old?{...old,evidence,confirmed_by:this.actor.id,confirmed_at:at}:{tag_id:t.id,category_id:t.category_id,type:t.type,category_name:t.category_name,name:t.name,description:t.description,definition_version:t.version,category_version:t.category_version,color:t.color,enabled:t.enabled,category_enabled:t.category_enabled,merged_into:t.merged_into,added_by:this.actor.id,added_at:at,confirmed_by:this.actor.id,confirmed_at:at,evidence,focus:0};next.set(c.tag_id,b);
  }
  if(a.focus!==undefined){for(const b of next.values())if(b.focus>0&&!await this.state.visible(b))throw new Failure(403,'SOURCE_RESTRICTED','存在当前不可读的重点依据，暂不能整体调整重点');for(const id of a.focus){const b=next.get(id);if(!b||!await this.state.visible(b))throw new Failure(400,'INVALID_FOCUS','重点只能选择当前可见绑定');}for(const [id,b] of next)next.set(id,{...b,focus:a.focus.indexOf(id)+1});}
  const after=[...next.values()],comparison=(items:TagBinding[])=>JSON.stringify(items.map(b=>[b.tag_id,b.evidence,b.focus]).sort((x,y)=>String(x[0]).localeCompare(String(y[0])))),changed=comparison(before)!==comparison(after);
  const statements=[this.archives.guard(a.archive_id,a.expected_version,key),...guards];
  if(changed){
   for(const b of before)if(!next.has(b.tag_id))statements.push(this.stmt('DELETE FROM archive_tags WHERE archive_id=? AND tag_id=?',a.archive_id,b.tag_id));
   for(const b of after)statements.push(this.stmt('INSERT INTO archive_tags(archive_id,tag_id,added_by,added_at,confirmed_by,confirmed_at,evidence_json,focus) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(archive_id,tag_id) DO UPDATE SET confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,evidence_json=excluded.evidence_json,focus=excluded.focus',a.archive_id,b.tag_id,b.added_by,b.added_at,b.confirmed_by,b.confirmed_at,JSON.stringify(b.evidence),b.focus));
   const ids=new Set([...before,...after].filter(b=>{const x=before.find(x=>x.tag_id===b.tag_id),y=after.find(x=>x.tag_id===b.tag_id);return !x||!y||comparison([x])!==comparison([y]);}).map(b=>b.tag_id));
   statements.push(this.stmt('UPDATE archives SET version=version+1,updated_at=? WHERE id=?',at,a.archive_id),this.archives.event(a.archive_id,'archive.tags_changed',before.filter(b=>ids.has(b.tag_id)),after.filter(b=>ids.has(b.tag_id)),at));
  }
  statements.push(...cleanup,this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
  return {result:{archive_id:a.archive_id,archive_url:this.archives.url(archive),version:archive.version+(changed?1:0),changed,added:after.filter(b=>!before.some(x=>x.tag_id===b.tag_id)).map(b=>b.tag_id),removed:before.filter(b=>!next.has(b.tag_id)).map(b=>b.tag_id)},statements};
 });}
}
