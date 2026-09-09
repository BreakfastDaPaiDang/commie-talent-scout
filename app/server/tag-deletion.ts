import {z} from 'zod';
import {command,type Source} from './commands.ts';
import {assertAdmin} from './credentials.ts';
import {TagMaintenance,tagApplyInput,publicTagDefinition} from './tag-maintenance.ts';
import {TagPreviews,type TagExpectation} from './tag-previews.ts';
import {nameKey} from './tags.ts';
import {Failure,now,type Actor,type Env} from './types.ts';

export const tagDeletionInput=z.object({entity_type:z.enum(['tag','category']),id:z.uuid(),deleted:z.boolean(),reason:z.string().trim().min(1).max(300)}).strict();
type Change=z.infer<typeof tagDeletionInput>;

// Catalog removal retains stable definitions for explicit historical references.
export class TagDeletion {
 readonly maintenance:TagMaintenance;
 constructor(readonly env:Env,readonly actor:Actor,readonly source:Source){this.maintenance=new TagMaintenance(env,actor,source);}
 private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 private async inspect(a:Change){
  const before=await this.maintenance.definition(a),expected:TagExpectation[]=[{entity_type:a.entity_type,id:a.id,version:before.version,impact_version:before.impact_version}];
  if(!a.deleted&&a.entity_type==='tag'&&'category_id' in before){
   const c=await this.maintenance.definition({entity_type:'category',id:before.category_id});
   if(c.deleted)throw new Failure(409,'CATEGORY_DELETED','请先恢复所属类别，再恢复词条');
   expected.push({entity_type:'category',id:c.id,version:c.version,impact_version:c.impact_version});
  }
  if(!a.deleted&&before.deleted){
   const collision=a.entity_type==='tag'&&'category_id' in before
    ?await this.stmt('SELECT id FROM tags WHERE category_id=? AND name_key=? AND id<>?',before.category_id,nameKey(before.name),a.id).first()
    :await this.stmt('SELECT id FROM tag_categories WHERE type=? AND name_key=? AND id<>?',before.type,nameKey(before.name),a.id).first();
   if(collision)throw new Failure(409,'DUPLICATE_VALUE','已有同名内容，不能恢复；请先核对并处理当前词义');
  }
  const childTags=a.entity_type==='category'?(await this.stmt('SELECT count(*) n FROM tags WHERE category_id=? AND deleted=0',a.id).first<{n:number}>())!.n:0;
  return {before,expected,childTags};
 }
 async preview(input:unknown){
  assertAdmin(this.actor);const a=tagDeletionInput.parse(input),{before,expected,childTags}=await this.inspect(a),saved=await new TagPreviews(this.env,this.actor).save(a,expected);
  const notice=a.deleted?'从词库及常规查询移除。'+(a.entity_type==='category'?'类别下的词条一并隐藏。':'')+'已有绑定与历史引用保留，名称可重新使用。':'恢复后保持停用，需另行启用。'+(a.entity_type==='category'?'恢复类别不会恢复单独删除的词条。':'');
  return {...saved,before:publicTagDefinition(before),deleted:a.deleted,changed:!!before.deleted!==a.deleted,child_tags:childTags,counts:await this.maintenance.counts(a),notice};
 }
 async apply(input:unknown){
  const a=tagApplyInput.parse(input);return command(this.env,this.actor,{requestId:a.request_id,operation:'tag.deletion',parameters:{preview_id:a.preview_id},requireAdmin:true},async()=>{
   const previews=new TagPreviews(this.env,this.actor),preview=await previews.read(a.preview_id),change=tagDeletionInput.parse(preview.input),{statements,cleanup}=await previews.guards(preview.expected),{before}=await this.inspect(change),changed=!!before.deleted!==change.deleted,version=before.version+(changed?1:0),at=now();
   if(changed){
    const table=change.entity_type==='tag'?'tags':'tag_categories';
    statements.push(this.stmt(`UPDATE ${table} SET deleted=?,enabled=0,name_key=?,deleted_name_key=?,version=version+1,updated_at=? WHERE id=?`,Number(change.deleted),change.deleted?'deleted:'+before.id:nameKey(before.name),change.deleted?nameKey(before.name):null,at,before.id));
    statements.push(this.stmt('INSERT INTO tag_definition_history(id,entity_type,version,definition_json,actor_id,created_at) VALUES(?,?,?,?,?,?)',before.id,change.entity_type,version,JSON.stringify({...publicTagDefinition(before),deleted:Number(change.deleted),enabled:0,version,reason:change.reason}),this.actor.id,at));
   }
   statements.push(...cleanup);return {result:{id:before.id,entity_type:change.entity_type,deleted:change.deleted,enabled:changed?false:!!before.enabled,version,changed},statements};
  });
 }
}
