import {z} from 'zod';
import {assertAdmin} from './credentials.ts';
import {command,expectedVersion,type Source} from './commands.ts';
import {Tags,type TagDefinition} from './tags.ts';
import {TagMaintenance,tagApplyInput,publicTagDefinition} from './tag-maintenance.ts';
import {TagPreviews,type TagExpectation} from './tag-previews.ts';
import {evidenceInput,type Evidence,type TagBinding} from './tag-state.ts';
import {Failure,now,uid,type Actor,type Env} from './types.ts';

const selection=z.object({archive_id:z.uuid(),expected_version:expectedVersion,evidence:z.array(evidenceInput).max(30).optional()}).strict();
export const tagMigrationInput=z.object({mode:z.enum(['meaning_change','merge']),from_tag_id:z.uuid(),to_tag_id:z.uuid(),archives:z.array(selection).max(10),reason:z.string().trim().min(1).max(300)}).strict().refine(a=>a.from_tag_id!==a.to_tag_id,'迁移来源与目标不能相同').refine(a=>new Set(a.archives.map(s=>s.archive_id)).size===a.archives.length,'同一批档案不能重复').refine(a=>a.mode==='merge'||(a.archives.length>0&&a.archives.every(s=>s.evidence?.length)),'新词义迁移须逐档案给出支持目标词义的依据');
type Migration=z.infer<typeof tagMigrationInput>;
type Definition=TagDefinition&{impact_version:number};
const evidenceKey=(e:Evidence)=>JSON.stringify([e.kind,e.note,e.observation_id??null,e.content_version??null]);
const uniqueEvidence=(items:Evidence[])=>[...new Map(items.map(e=>[evidenceKey(e),e])).values()];

// A bounded, atomic set of archive changes. Public definition edits use another command.
export class TagMigration {
 readonly tags:Tags;readonly maintenance:TagMaintenance;
 constructor(readonly env:Env,readonly actor:Actor,readonly source:Source){this.tags=new Tags(env,actor,source);this.maintenance=new TagMaintenance(env,actor,source);}
 private stmt(sql:string,...args:unknown[]){return this.env.DB.prepare(sql).bind(...args);}
 private async definitions(a:Migration){if(a.mode==='merge')assertAdmin(this.actor);const from=await this.maintenance.definition({entity_type:'tag',id:a.from_tag_id}) as Definition,to=await this.maintenance.definition({entity_type:'tag',id:a.to_tag_id}) as Definition;
  this.maintenance.assertMutable(from);this.maintenance.assertMutable(to);if(from.type!==to.type)throw new Failure(400,'TAG_TYPE_MISMATCH','不能跨人物与组织词库迁移');if(!to.enabled||!to.category_enabled||to.merged_into)throw new Failure(409,'TAG_DISABLED','目标标签或类别已停用或合并，请选择当前可用词义');if(a.mode==='merge'&&from.merged_into&&from.merged_into!==to.id)throw new Failure(409,'MERGE_TARGET_CHANGED','来源已有其他合并去向，请核对当前词义后重新选择');return {from,to};
 }
 private async plan(a:Migration,to:Definition){const result=[];
  for(const selected of a.archives){const archive=await this.tags.archives.get(selected.archive_id,selected.expected_version,true),all=await this.tags.state.raw(archive.id),source=all.find(b=>b.tag_id===a.from_tag_id),target=all.find(b=>b.tag_id===a.to_tag_id);
   if(!source)throw new Failure(409,'BINDING_NOT_FOUND','选中的档案已不再绑定来源标签，请重新选择');const visible=await this.tags.state.visible(source);if(!visible||(target&&!await this.tags.state.visible(target)))throw new Failure(403,'SOURCE_RESTRICTED','选中绑定的来源当前不可读，不能迁移');
   if(archive.type!==to.type)throw new Failure(400,'TAG_TYPE_MISMATCH','档案与目标标签不在同一词库');
   if(a.mode==='meaning_change')await this.tags.state.validateEvidence(selected.evidence!,archive.id,this.source==='mcp');
   const evidence=uniqueEvidence([...(target?.evidence??[]),...(a.mode==='merge'?visible.evidence:selected.evidence!)]);if(evidence.length>30)throw new Failure(409,'TOO_MUCH_EVIDENCE','合并后的依据超过 30 条，请先在授权范围内整理依据');
   // Existing target wins a focus conflict; otherwise the vacated source rank can be reused.
   const focus=target?.focus||source.focus,at=now();
   const next:TagBinding=target?{...target,evidence,focus,confirmed_by:this.actor.id,confirmed_at:at}:{...source,tag_id:to.id,category_id:to.category_id,category_name:to.category_name,name:to.name,description:to.description,definition_version:to.version,category_version:to.category_version,color:to.color,enabled:to.enabled,category_enabled:to.category_enabled,merged_into:to.merged_into,evidence,focus,...(a.mode==='meaning_change'?{added_by:this.actor.id,added_at:at}:{}),confirmed_by:this.actor.id,confirmed_at:at};
   const visibleNext=await this.tags.state.visible(next);result.push({archive,source,target,next,visibleEvidenceCount:visibleNext?.evidence.length??0});
  }return result;
 }
 async preview(input:unknown){const a=tagMigrationInput.parse(input),{from,to}=await this.definitions(a),plan=await this.plan(a,to),expected:TagExpectation[]=[from,to].map(t=>({entity_type:'tag',id:t.id,version:t.version,impact_version:t.impact_version}));
  for(const id of new Set([from.category_id,to.category_id])){const c=await this.maintenance.definition({entity_type:'category',id});expected.push({entity_type:'category',id,version:c.version,impact_version:c.impact_version});}
  const saved=await new TagPreviews(this.env,this.actor).save(a,expected),counts=await this.maintenance.counts({entity_type:'tag',id:from.id});
  return {...saved,mode:a.mode,from:publicTagDefinition(from),to:publicTagDefinition(to),counts,selected:plan.map(p=>({archive_id:p.archive.id,name:p.archive.name,version:p.archive.version,target_already_bound:!!p.target,source_focus:p.source.focus,target_focus:p.next.focus,evidence_count:p.visibleEvidenceCount})),remaining_open:Math.max(0,counts.open-plan.length),preserved_closed:counts.closed,notice:a.mode==='merge'?'只迁移本批选中的开启档案；来源停用并保留合并去向，未选和关闭绑定继续可读。':'只迁移本批明确选中的开启档案，保留旧词条及未选/关闭绑定，不改变旧词义。'};
 }
 async apply(input:unknown){const a=tagApplyInput.parse(input),previews=new TagPreviews(this.env,this.actor);
  // The receipt also enforces administrator scope when an already-completed merge is retried.
  const receipt=await this.stmt('SELECT require_admin FROM commands WHERE member_id=? AND request_id=?',this.actor.id,a.request_id).first<{require_admin:number}>(),proposal=receipt?null:await previews.read(a.preview_id),requiresAdmin=receipt?!!receipt.require_admin:tagMigrationInput.parse(proposal!.input).mode==='merge';
  return command(this.env,this.actor,{requestId:a.request_id,operation:'tag.migration',parameters:{preview_id:a.preview_id},requireAdmin:requiresAdmin},async()=>{
   const preview=proposal??await previews.read(a.preview_id),change=tagMigrationInput.parse(preview.input),{statements,cleanup}=await previews.guards(preview.expected),{from,to}=await this.definitions(change),plan=await this.plan(change,to),at=now();
   // All guards precede every effect, so any conflict rejects the entire chosen batch.
   for(const p of plan){const key=uid();statements.push(this.tags.archives.guard(p.archive.id,p.archive.version,key));cleanup.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',key));
    const evidence=change.mode==='merge'?[...p.source.evidence,...(p.target?.evidence??[])]:change.archives.find(s=>s.archive_id===p.archive.id)!.evidence!;
    const refs=evidence.filter(e=>e.observation_id);if(refs.length){const access=uid();statements.push(this.stmt("INSERT INTO mutation_guards VALUES(?,CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM observations o WHERE o.id=json_extract(e.value,'$.observation_id') AND (o.deleted=0 OR o.author_id=? OR ?='admin'))) THEN 1 ELSE 0 END)",access,JSON.stringify(refs),this.actor.id,this.actor.role));cleanup.push(this.stmt('DELETE FROM mutation_guards WHERE id=?',access));}
   }
   for(const p of plan){statements.push(this.stmt('DELETE FROM archive_tags WHERE archive_id=? AND tag_id=?',p.archive.id,from.id),this.stmt('INSERT INTO archive_tags(archive_id,tag_id,added_by,added_at,confirmed_by,confirmed_at,evidence_json,focus) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(archive_id,tag_id) DO UPDATE SET confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at,evidence_json=excluded.evidence_json,focus=excluded.focus',p.archive.id,to.id,p.next.added_by,p.next.added_at,this.actor.id,at,JSON.stringify(p.next.evidence),p.next.focus),this.stmt('UPDATE archives SET version=version+1,updated_at=? WHERE id=?',at,p.archive.id),this.tags.archives.event(p.archive.id,'archive.tags_changed',[p.source,...(p.target?[p.target]:[])],[{...p.next,confirmed_at:at}],at));}
   const definitionChanged=change.mode==='merge'&&(from.enabled!==0||from.merged_into!==to.id);
   if(definitionChanged){statements.push(this.stmt('UPDATE tags SET enabled=0,merged_into=?,version=version+1,updated_at=? WHERE id=?',to.id,at,from.id),this.stmt('INSERT INTO tag_definition_history(id,entity_type,version,definition_json,actor_id,created_at) VALUES(?,?,?,?,?,?)',from.id,'tag',from.version+1,JSON.stringify({...from,enabled:0,merged_into:to.id,version:from.version+1,reason:change.reason}),this.actor.id,at));}
   statements.push(...cleanup);const counts=await this.maintenance.counts({entity_type:'tag',id:from.id});
   return {result:{from_tag_id:from.id,to_tag_id:to.id,changed:plan.length>0||definitionChanged,completed:plan.map(p=>({archive_id:p.archive.id,version:p.archive.version+1,archive_url:this.tags.archives.url(p.archive)})),remaining_open:Math.max(0,counts.open-plan.length),preserved_closed:counts.closed,source_version:from.version+(definitionChanged?1:0)},statements};
  });
 }
}
