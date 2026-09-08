import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Tags} from '../app/server/tags.ts';
import {TagMaintenance} from '../app/server/tag-maintenance.ts';
import {TagMigration} from '../app/server/tag-migration.ts';
const evidence=note=>[{kind:'member_instruction',note}];
async function setup(f,admin=false){if(admin){f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';}const tags=new Tags(f.env,f.actor,'web'),archives=new Archives(f.env,f.actor,'web'),migration=new TagMigration(f.env,f.actor,'web'),maintenance=new TagMaintenance(f.env,f.actor,'web'),category=await tags.createCategory({type:'person',name:'虚构迁移',request_id:uuid()}),from=await tags.create({category_id:category.id,name:'源词条',description:'源词义',request_id:uuid()}),to=await tags.create({category_id:category.id,name:'目标词条',description:'目标词义',request_id:uuid()}),ids=[];
 for(let i=0;i<4;i++){const a=await archives.create({type:'person',name:'虚构迁移 '+i,request_id:uuid()});ids.push(a.id);await tags.batch({archive_id:a.id,expected_version:1,changes:[{tag_id:from.id,action:'add',evidence:evidence('共同依据')},...(i===1?[{tag_id:to.id,action:'add',evidence:[...evidence('共同依据'),...evidence('目标独立依据')]}]:[])],focus:i===1?[to.id,from.id]:[from.id],request_id:uuid()});if(i===3)await archives.setState({id:a.id,expected_version:2,status:'已弃用',member_ids:[],request_id:uuid()});}
 return {tags,archives,migration,maintenance,category,from,to,ids};
}
test('meaning change moves only explicit open archives with new supporting evidence, never reinterprets old definition',async t=>{
 const f=fixture();t.after(f.close);const {migration:m,archives:s,maintenance,from,to,ids}=await setup(f),input={mode:'meaning_change',from_tag_id:from.id,to_tag_id:to.id,reason:'新特征的明确依据',archives:[{archive_id:ids[0],expected_version:2,evidence:evidence('新词义所需的明确支持材料')}]};
 const originalAuthor=uuid();f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,created_at) VALUES(?,?,?,'member','fixture',?)").run(originalAuthor,'origin-'+originalAuthor,'原绑定作者',new Date().toISOString());f.sqlite.prepare('UPDATE archive_tags SET added_by=? WHERE tag_id=?').run(originalAuthor,from.id);
 await assert.rejects(m.preview({...input,archives:[{archive_id:ids[0],expected_version:2}]}));
 const p=await m.preview(input);assert.equal(p.remaining_open,2);assert.equal(p.preserved_closed,1);const request={preview_id:p.preview_id,request_id:uuid()},r=await m.apply(request);assert.equal(r.completed.length,1);assert.equal(r.completed[0].archive_id,ids[0]);assert.equal((await s.detail(ids[0])).archive.tags[0].evidence[0].note,'新词义所需的明确支持材料');assert.equal((await s.detail(ids[2])).archive.tags[0].tag_id,from.id);assert.equal((await s.detail(ids[3])).archive.tags[0].tag_id,from.id);assert.equal((await maintenance.detail({entity_type:'tag',id:from.id})).definition.version,1);
 assert.equal((await s.detail(ids[0])).archive.tags[0].added_by,f.actor.id,'a different meaning is credited to the member who supplied the new evidence');
 f.sqlite.prepare("UPDATE tag_maintenance_previews SET expires_at='2020-01-01T00:00:00.000Z'").run();assert.equal((await m.apply(request)).replayed,true,'committed receipt survives preview expiration');
});

test('a role change at the transaction boundary rejects all merge effects and the preview cannot be replayed as a member',async t=>{
 const f=fixture();t.after(f.close);const {migration:m,archives:s,from,to,ids}=await setup(f,true),p=await m.preview({mode:'merge',from_tag_id:from.id,to_tag_id:to.id,reason:'权限并发验收',archives:[{archive_id:ids[0],expected_version:2},{archive_id:ids[1],expected_version:2}]}),batch=f.env.DB.batch;
 f.env.DB.batch=async statements=>{f.sqlite.prepare("UPDATE members SET role='member',auth_epoch=auth_epoch+1 WHERE id=?").run(f.actor.id);f.env.DB.batch=batch;return batch(statements);};
 await assert.rejects(m.apply({preview_id:p.preview_id,request_id:uuid()}),e=>e.code==='PRECONDITION_CHANGED');assert.equal((await s.detail(ids[0])).archive.tags[0].tag_id,from.id);assert.equal(f.sqlite.prepare('SELECT enabled FROM tags WHERE id=?').get(from.id).enabled,1);
});
test('administrator merges duplicate evidence and preserves target focus, origins, closed snapshots and unselected source bindings',async t=>{
 const f=fixture();t.after(f.close);const {migration:m,archives:s,maintenance,from,to,ids}=await setup(f,true),input={mode:'merge',from_tag_id:from.id,to_tag_id:to.id,reason:'两词条确认同义',archives:[{archive_id:ids[0],expected_version:2},{archive_id:ids[1],expected_version:2}]};
 await assert.rejects(new TagMigration(f.env,{...f.actor,role:'member'},'web').preview(input),e=>e.code==='ADMIN_REQUIRED');const p=await m.preview(input);assert.equal(p.selected[1].target_already_bound,true);assert.equal(p.selected[1].target_focus,1);assert.equal(p.selected[1].evidence_count,2);
 const req={preview_id:p.preview_id,request_id:uuid()},result=await m.apply(req);assert.equal(result.completed.length,2);assert.equal(result.remaining_open,1);assert.equal(result.preserved_closed,1);
 const combined=(await s.detail(ids[1])).archive.tags;assert.equal(combined.length,1);assert.equal(combined[0].tag_id,to.id);assert.equal(combined[0].evidence.length,2);assert.equal(combined[0].focus,1);assert.equal(combined[0].added_by,f.actor.id);
 const old=(await maintenance.detail({entity_type:'tag',id:from.id})).definition;assert.equal(old.enabled,0);assert.equal(old.merged_into,to.id);assert.equal((await s.detail(ids[2])).archive.tags[0].tag_id,from.id);assert.equal((await s.detail(ids[3])).archive.tags[0].name,'源词条');assert.equal((await s.detail(ids[3])).archive.tags[0].merged_into,to.id);
 const events=await s.events({id:ids[1]});assert.ok(events.events.some(e=>e.kind==='archive.tags_changed'&&e.before.some(t=>t.tag_id===from.id)&&e.after.some(t=>t.tag_id===to.id)));
 assert.equal((await m.apply(req)).replayed,true);await assert.rejects(new TagMigration(f.env,{...f.actor,role:'member'},'web').apply(req),e=>e.code==='ADMIN_REQUIRED');
 const follow=await m.preview({...input,archives:[{archive_id:ids[2],expected_version:2}]});assert.equal((await m.apply({preview_id:follow.preview_id,request_id:uuid()})).remaining_open,0);
});
test('one stale archive rejects a whole migration batch and disabling/restoring changes availability without moving activity or history',async t=>{
 const f=fixture();t.after(f.close);const {migration:m,archives:s,maintenance:lib,tags,from,to,ids,category}=await setup(f,true),input={mode:'merge',from_tag_id:from.id,to_tag_id:to.id,reason:'虚构批次',archives:[{archive_id:ids[0],expected_version:2},{archive_id:ids[1],expected_version:2}]},p=await m.preview(input);
 await s.update({id:ids[1],expected_version:2,name:'并发资料修改',contacts:[],links:[],request_id:uuid()});await assert.rejects(m.apply({preview_id:p.preview_id,request_id:uuid()}),e=>e.code==='VERSION_CONFLICT');assert.equal((await s.detail(ids[0])).archive.tags[0].tag_id,from.id);assert.equal((await lib.detail({entity_type:'tag',id:from.id})).definition.enabled,1);
 const before=f.sqlite.prepare('SELECT id,updated_at,version FROM archives ORDER BY id').all(),disabled=await lib.previewAvailability({entity_type:'category',id:category.id,enabled:false,reason:'暂不新增'});assert.equal(disabled.counts.archives,4);await lib.applyAvailability({preview_id:disabled.preview_id,request_id:uuid()});assert.deepEqual(f.sqlite.prepare('SELECT id,updated_at,version FROM archives ORDER BY id').all(),before);
 await assert.rejects(tags.batch({archive_id:ids[2],expected_version:2,changes:[{tag_id:to.id,action:'add',evidence:evidence('新绑定')}],request_id:uuid()}),e=>e.code==='TAG_DISABLED');assert.equal((await s.detail(ids[2])).archive.tags.length,1);
 const restore=await lib.previewAvailability({entity_type:'category',id:category.id,enabled:true,reason:'恢复新增'});await lib.applyAvailability({preview_id:restore.preview_id,request_id:uuid()});await tags.batch({archive_id:ids[2],expected_version:2,changes:[{tag_id:to.id,action:'add',evidence:evidence('新绑定')}],request_id:uuid()});assert.equal((await lib.detail({entity_type:'category',id:category.id})).history.length,3);
});
