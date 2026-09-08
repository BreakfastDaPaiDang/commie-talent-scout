import {z} from 'zod';
import {command,requestId,type Source} from './commands.ts';
import {Tags,tagCreateInput,categoryCreateInput,nameKey,type TagDefinition} from './tags.ts';
import {TagState,bindingJson,evidenceVisibilitySql,type TagBinding} from './tag-state.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';
import {TagPreviews,type TagExpectation} from './tag-previews.ts';
import {assertAdmin} from './credentials.ts';

const subject={entity_type:z.enum(['tag','category']),id:z.uuid()};
export const tagDetailInput=z.object({...subject,before:z.coerce.number().int().positive().optional(),limit:z.coerce.number().int().min(1).max(50).default(20)});
export const tagBindingsInput=z.object({...subject,closed:z.enum(['all','open','closed']).default('all'),before:z.uuid().optional(),limit:z.coerce.number().int().min(1).max(50).default(30)});
export const tagPreviewInput=z.discriminatedUnion('entity_type',[
 z.object({entity_type:z.literal('tag'),id:z.uuid(),name:tagCreateInput.shape.name,description:tagCreateInput.shape.description,category_id:z.uuid(),reason:z.string().trim().min(1).max(300)}).strict(),
 z.object({entity_type:z.literal('category'),id:z.uuid(),name:categoryCreateInput.shape.name,description:categoryCreateInput.shape.description,color:categoryCreateInput.shape.color,reason:z.string().trim().min(1).max(300)}).strict(),
]);
export const tagApplyInput=z.object({preview_id:z.uuid(),request_id:requestId}).strict();
export const tagAvailabilityInput=z.object({...subject,enabled:z.boolean(),reason:z.string().trim().min(1).max(300)}).strict();
type Subject=z.infer<typeof tagDetailInput>;
type Change=z.infer<typeof tagPreviewInput>;
type Category={id:string;type:'person'|'org';name:string;description:string;color:string;version:number;enabled:number;impact_version:number};
const effectiveEvidence="CASE WHEN a.closed=1 THEN json_extract(s.data_json,'$.evidence') ELSE b.evidence_json END";
const bindingSource='archive_tags b JOIN archives a ON a.id=b.archive_id JOIN tags t ON t.id=b.tag_id JOIN tag_categories c ON c.id=t.category_id LEFT JOIN archive_tag_snapshots s ON s.archive_id=a.id AND s.close_version=a.tag_snapshot_version AND s.tag_id=b.tag_id';
// Impact counters also change for hidden sources. Keep them server-side, unlike public definition versions.
export function publicTagDefinition<T>(value:T):Omit<T,'impact_version'>{const {impact_version:_,...definition}=value as T&{impact_version?:unknown};return definition;}

// Public vocabulary changes own previews and history; they never touch archive activity.
export class TagMaintenance {
 readonly tags:Tags;
 constructor(readonly env:Env,readonly actor:Actor,readonly source:Source){this.tags=new Tags(env,actor,source);}
 private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 async definition(subject:Pick<Subject,'entity_type'|'id'>):Promise<(TagDefinition&{impact_version:number})|Category>{
  if(subject.entity_type==='tag'){const definition=await this.tags.definition(subject.id),revision=await this.stmt('SELECT impact_version FROM tags WHERE id=?',subject.id).first<{impact_version:number}>();return {...definition,impact_version:revision!.impact_version};}
  const category=await this.stmt('SELECT id,type,name,description,color,version,enabled,impact_version FROM tag_categories WHERE id=?',subject.id).first<Category>();if(!category)throw new Failure(404,'NOT_FOUND','类别不存在');return category;
 }
 private bindingScope(subject:Pick<Subject,'entity_type'|'id'>){return subject.entity_type==='tag'?'t.id=?':'c.id=?';}
 async counts(subject:Pick<Subject,'entity_type'|'id'>){
  const r=await this.stmt(`SELECT count(DISTINCT a.id) archives,count(*) bindings,count(DISTINCT CASE WHEN a.closed=0 THEN a.id END) open,count(DISTINCT CASE WHEN a.closed=1 THEN a.id END) closed FROM ${bindingSource} WHERE ${this.bindingScope(subject)} AND ${evidenceVisibilitySql(effectiveEvidence)}`,subject.id,this.actor.id,this.actor.role).first<{archives:number;bindings:number;open:number;closed:number}>();return {...r!};
 }
 async detail(input:unknown){const a=tagDetailInput.parse(input),definition=await this.definition(a),counts=await this.counts(a),rows=(await this.stmt(`SELECT version,definition_json,actor_id,(SELECT name FROM members WHERE id=actor_id) actor_name,created_at FROM tag_definition_history WHERE entity_type=? AND id=? ${a.before?'AND version<?':''} ORDER BY version DESC LIMIT ?`,a.entity_type,a.id,...(a.before?[a.before]:[]),a.limit+1).all<{version:number;definition_json:string;actor_id:string;actor_name:string;created_at:string}>()).results;
  return {definition:publicTagDefinition(definition),counts,can_administer:this.actor.role==='admin',history:rows.slice(0,a.limit).map(({definition_json,...r})=>({...r,definition:publicTagDefinition(JSON.parse(definition_json))})),next_cursor:rows.length>a.limit?rows[a.limit-1].version:null};
 }
 async bindings(input:unknown){const a=tagBindingsInput.parse(input);await this.definition(a);const where=[this.bindingScope(a),evidenceVisibilitySql(effectiveEvidence)],args:unknown[]=[a.id,this.actor.id,this.actor.role];if(a.closed!=='all')where.push(`a.closed=${a.closed==='closed'?1:0}`);if(a.before){where.push('a.id>?');args.push(a.before);}
  // Page archive IDs first, so a category with several tags does not split one archive.
  const rows=(await this.stmt(`SELECT DISTINCT a.id,a.type,a.name,a.closed,a.version FROM ${bindingSource} WHERE ${where.join(' AND ')} ORDER BY a.id LIMIT ?`,...args,a.limit+1).all<{id:string;type:'person'|'org';name:string;closed:number;version:number}>()).results,archives=[];
  for(const row of rows.slice(0,a.limit)){
   const bindings=(await this.stmt(`SELECT CASE WHEN a.closed=1 THEN json_set(s.data_json,'$.color',c.color,'$.enabled',t.enabled,'$.category_enabled',c.enabled,'$.merged_into',t.merged_into) ELSE ${bindingJson} END data_json FROM ${bindingSource} WHERE a.id=? AND ${this.bindingScope(a)} AND ${evidenceVisibilitySql(effectiveEvidence)}`,row.id,a.id,this.actor.id,this.actor.role).all<{data_json:string}>()).results;
   const state=new TagState(this.env,this.actor),visible=(await Promise.all(bindings.map(b=>state.visible(JSON.parse(b.data_json) as TagBinding)))).filter(Boolean);
   archives.push({...row,closed:!!row.closed,url:this.tags.archives.url(row),tags:visible});
  }
  return {archives,next_cursor:rows.length>a.limit?archives.at(-1)!.id:null};
 }
 async preview(input:unknown){const a=tagPreviewInput.parse(input),before=await this.definition(a),expected:TagExpectation[]=[{entity_type:a.entity_type,id:a.id,version:before.version,impact_version:before.impact_version}];
  let after:Record<string,unknown>;
  if(a.entity_type==='tag'){
   const current=before as TagDefinition&{impact_version:number},category=await this.definition({entity_type:'category',id:a.category_id}) as Category;
   if(category.type!==before.type)throw new Failure(400,'TAG_TYPE_MISMATCH','不能跨人物和组织词库换类');if(!category.enabled&&a.category_id!==current.category_id)throw new Failure(409,'CATEGORY_DISABLED','不能迁入停用类别');
   expected.push({entity_type:'category',id:category.id,version:category.version,impact_version:category.impact_version});
   if(category.id!==current.category_id){const oldCategory=await this.definition({entity_type:'category',id:current.category_id}) as Category;expected.push({entity_type:'category',id:oldCategory.id,version:oldCategory.version,impact_version:oldCategory.impact_version});}
   const collision=await this.stmt('SELECT id FROM tags WHERE category_id=? AND name_key=? AND id<>?',category.id,nameKey(a.name),a.id).first();if(collision)throw new Failure(409,'DUPLICATE_VALUE','目标类别已有同名标签，请复用或由管理员合并');
   after={...before,name:a.name,description:a.description,category_id:category.id,category_name:category.name,category_version:category.version,color:category.color};
  }else{
   if(await this.stmt('SELECT id FROM tag_categories WHERE type=? AND name_key=? AND id<>?',before.type,nameKey(a.name),a.id).first())throw new Failure(409,'DUPLICATE_VALUE','本词库已有同名类别');
   after={...before,name:a.name,description:a.description,color:a.color};
  }
  const fields=a.entity_type==='tag'?['name','description','category_id']:['name','description','color'],diff=fields.filter(k=>(before as Record<string,unknown>)[k]!==after[k]).map(field=>({field,before:(before as Record<string,unknown>)[field],after:after[field]}));
  const saved=await new TagPreviews(this.env,this.actor).save(a,expected);
  return {...saved,before:publicTagDefinition(before),after:publicTagDefinition(after),diff,counts:await this.counts(a),changed:diff.length>0,notice:'仅澄清同一词义；开启档案显示新定义，关闭快照和旧历史保留原文。若含义改变，请新建词条并明确选择迁移档案。'};
 }
 async apply(input:unknown){const a=tagApplyInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'tag.definition',parameters:{preview_id:a.preview_id}},async()=>{
  const previews=new TagPreviews(this.env,this.actor),preview=await previews.read(a.preview_id),change=tagPreviewInput.parse(preview.input),{statements,cleanup}=await previews.guards(preview.expected);
  const before=await this.definition(change),at=now(),fields=change.entity_type==='tag'?['name','description','category_id']:['name','description','color'],changed=fields.some(k=>(before as Record<string,unknown>)[k]!==change[k as keyof Change]),version=before.version+(changed?1:0);
  if(changed){
   if(change.entity_type==='tag')statements.push(this.stmt('UPDATE tags SET name=?,name_key=?,description=?,category_id=?,version=version+1,updated_at=? WHERE id=?',change.name,nameKey(change.name),change.description,change.category_id,at,change.id));
   else statements.push(this.stmt('UPDATE tag_categories SET name=?,name_key=?,description=?,color=?,version=version+1,updated_at=? WHERE id=?',change.name,nameKey(change.name),change.description,change.color,at,change.id));
   // Read the final row in the same transaction, including a destination category's current label.
   const definition=change.entity_type==='tag'?"SELECT json_object('id',t.id,'category_id',c.id,'category_name',c.name,'category_version',c.version,'type',c.type,'name',t.name,'description',t.description,'color',c.color,'version',t.version,'enabled',t.enabled,'merged_into',t.merged_into) FROM tags t JOIN tag_categories c ON c.id=t.category_id WHERE t.id=?":"SELECT json_object('id',id,'type',type,'name',name,'description',description,'color',color,'version',version,'enabled',enabled) FROM tag_categories WHERE id=?";
   statements.push(this.stmt(`INSERT INTO tag_definition_history(id,entity_type,version,definition_json,actor_id,created_at) VALUES(?,?,?,json_set((${definition}),'$.reason',?),?,?)`,change.id,change.entity_type,version,change.id,change.reason,this.actor.id,at));
  }
  statements.push(...cleanup);return {result:{id:change.id,entity_type:change.entity_type,version,changed},statements};
 });}
 async previewAvailability(input:unknown){assertAdmin(this.actor);const a=tagAvailabilityInput.parse(input),before=await this.definition(a),expected:TagExpectation[]=[{entity_type:a.entity_type,id:a.id,version:before.version,impact_version:before.impact_version}],after={...before,enabled:a.enabled?1:0,...(a.entity_type==='tag'&&a.enabled?{merged_into:null}:{})};
  const saved=await new TagPreviews(this.env,this.actor).save(a,expected);return {...saved,before:publicTagDefinition(before),after:publicTagDefinition(after),counts:await this.counts(a),changed:before.enabled!==after.enabled||(a.entity_type==='tag'&&a.enabled&&!!(before as TagDefinition).merged_into),notice:a.enabled?'恢复后可以新增绑定；已有绑定与历史保持，曾合并出去的绑定不会自动迁回。':'停用后禁止新增绑定；已有绑定、关闭快照和历史继续可读。'};
 }
 async applyAvailability(input:unknown){const a=tagApplyInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'tag.availability',parameters:{preview_id:a.preview_id},requireAdmin:true},async()=>{
  const previews=new TagPreviews(this.env,this.actor),preview=await previews.read(a.preview_id),change=tagAvailabilityInput.parse(preview.input),{statements,cleanup}=await previews.guards(preview.expected),before=await this.definition(change),at=now(),changed=before.enabled!==Number(change.enabled)||(change.entity_type==='tag'&&change.enabled&&!!(before as TagDefinition).merged_into),version=before.version+(changed?1:0);
  if(changed){const after={...before,enabled:Number(change.enabled),version,...(change.entity_type==='tag'&&change.enabled?{merged_into:null}:{}),reason:change.reason};
   if(change.entity_type==='tag')statements.push(this.stmt('UPDATE tags SET enabled=?,merged_into=CASE WHEN ?=1 THEN NULL ELSE merged_into END,version=version+1,updated_at=? WHERE id=?',Number(change.enabled),Number(change.enabled),at,change.id));
   else statements.push(this.stmt('UPDATE tag_categories SET enabled=?,version=version+1,updated_at=? WHERE id=?',Number(change.enabled),at,change.id));
   statements.push(this.stmt('INSERT INTO tag_definition_history(id,entity_type,version,definition_json,actor_id,created_at) VALUES(?,?,?,?,?,?)',change.id,change.entity_type,version,JSON.stringify(after),this.actor.id,at));
  }
  statements.push(...cleanup);return {result:{id:change.id,entity_type:change.entity_type,enabled:change.enabled,changed,version},statements};
 });}
}
