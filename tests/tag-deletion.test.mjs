import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Tags} from '../app/server/tags.ts';
import {TagDeletion} from '../app/server/tag-deletion.ts';
import {TagMaintenance} from '../app/server/tag-maintenance.ts';
import {Archives} from '../app/server/archives.ts';

function admin(f){f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);return {...f.actor,role:'admin'};}
async function catalog(f){const actor=admin(f),tags=new Tags(f.env,actor,'web'),deletion=new TagDeletion(f.env,actor,'web'),maintenance=new TagMaintenance(f.env,actor,'web');const c=await tags.createCategory({type:'person',name:'虚构待清理',request_id:uuid()}),tag=await tags.create({category_id:c.id,name:'虚构词条',description:'清理测试',request_id:uuid()});return {actor,tags,deletion,maintenance,c,tag};}
async function change(s,entity_type,id,deleted=true){const p=await s.preview({entity_type,id,deleted,reason:'明确清理虚构词义'});return s.apply({preview_id:p.preview_id,request_id:uuid()});}

test('ordinary category discovery excludes disabled vocabulary; explicit maintenance can read it',async t=>{
 const f=fixture();t.after(f.close);const s=new Tags(f.env,f.actor,'web');
 const c=await s.createCategory({type:'person',name:'虚构已停用残留',request_id:uuid()});
 f.sqlite.prepare('UPDATE tag_categories SET enabled=0 WHERE id=?').run(c.id);
 assert.ok(!(await s.categories('person')).categories.some(x=>x.id===c.id),'disabled test categories must not pollute default discovery');
 assert.ok((await s.categories({type:'person',include_disabled:true})).categories.some(x=>x.id===c.id));
});

test('delete hides the entire category, preserves closed and current references, and restore does not revive separately deleted terms',async t=>{
 const f=fixture();t.after(f.close);const {actor,tags,deletion:d,maintenance:m,c,tag}=await catalog(f),a=new Archives(f.env,actor,'web');
 const open=await a.create({type:'person',name:'虚构引用',request_id:uuid()});await tags.batch({archive_id:open.id,expected_version:1,changes:[{tag_id:tag.id,action:'add'}],request_id:uuid()});await a.setState({id:open.id,expected_version:2,status:'已弃用',member_ids:[],request_id:uuid()});
 const before=f.sqlite.prepare('SELECT version,updated_at FROM archives WHERE id=?').get(open.id),events=f.sqlite.prepare('SELECT count(*) n FROM archive_events').get().n;
 const second=await tags.create({category_id:c.id,name:'单独删除',description:'清理测试',request_id:uuid()});await change(d,'tag',second.id);await change(d,'category',c.id);
 assert.ok(!(await tags.categories({type:'person',include_disabled:true})).categories.some(x=>x.id===c.id));assert.equal((await tags.list({type:'person',category_id:c.id,include_disabled:true})).tags.length,0);
 assert.equal((await tags.list({type:'person',category_id:c.id,include_deleted:true})).tags.length,2);
 assert.equal((await a.detail(open.id)).archive.tags[0].name,'虚构词条');assert.deepEqual(f.sqlite.prepare('SELECT version,updated_at FROM archives WHERE id=?').get(open.id),before);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM archive_events').get().n,events);
 await assert.rejects(m.previewAvailability({entity_type:'category',id:c.id,enabled:true,reason:'绕过删除'}),e=>e.code==='DEFINITION_DELETED');
 await assert.rejects(m.preview({entity_type:'tag',id:tag.id,category_id:c.id,name:'改名',description:'尝试改名',reason:'绕过删除'}),e=>e.code==='DEFINITION_DELETED');
 await assert.rejects(tags.create({category_id:c.id,name:'新词',description:'不可写入',request_id:uuid()}),e=>e.code==='CATEGORY_DELETED');
 await change(d,'category',c.id,false);assert.equal((await tags.categories('person')).categories.some(x=>x.id===c.id),false);
 const p=await m.previewAvailability({entity_type:'category',id:c.id,enabled:true,reason:'恢复使用'});await m.applyAvailability({preview_id:p.preview_id,request_id:uuid()});assert.deepEqual((await tags.list({type:'person',category_id:c.id})).tags.map(x=>x.id),[tag.id]);
 assert.equal((await m.detail({entity_type:'category',id:c.id})).history.find(x=>x.definition.deleted===1).definition.deleted,1);
});

test('deletion releases names; recovery never overwrites a new definition and retains original request receipts',async t=>{
 const f=fixture();t.after(f.close);const {tags,deletion:d,c,tag}=await catalog(f);
 const p=await d.preview({entity_type:'tag',id:tag.id,deleted:true,reason:'清理'}),input={preview_id:p.preview_id,request_id:uuid()};await d.apply(input);assert.equal((await d.apply(input)).replayed,true);assert.equal((await tags.list({type:'person',query:'虚构待清理：虚构词条',include_deleted:true})).tags[0].id,tag.id);
 const replacement=await tags.create({category_id:c.id,name:'虚构词条',description:'新正确词义',request_id:uuid()});assert.notEqual(replacement.id,tag.id);
 await assert.rejects(change(d,'tag',tag.id,false),e=>e.code==='DUPLICATE_VALUE');await change(d,'tag',replacement.id);await change(d,'tag',tag.id,false);
 assert.equal((await tags.list({type:'person',category_id:c.id})).tags.length,0);assert.equal((await tags.list({type:'person',category_id:c.id,include_disabled:true})).tags[0].id,tag.id);
 await change(d,'category',c.id);const other=await tags.createCategory({type:'person',name:'虚构待清理',request_id:uuid()});assert.notEqual(other.id,c.id);await assert.rejects(change(d,'category',c.id,false),e=>e.code==='DUPLICATE_VALUE');
});

test('permissions and stale definitions, new children, revoked identity, and transaction races reject deletion',async t=>{
 const f=fixture();t.after(f.close);const {actor,tags,deletion:d,c,tag}=await catalog(f),member=new Tags(f.env,{...actor,role:'member'},'mcp');
 await assert.rejects(member.categories({type:'person',include_deleted:true}),e=>e.status===403);await assert.rejects(member.list({type:'person',include_deleted:true}),e=>e.status===403);
 await assert.rejects(new TagDeletion(f.env,{...actor,role:'member'},'web').preview({entity_type:'tag',id:tag.id,deleted:true,reason:'清理'}),e=>e.status===403);
 let p=await d.preview({entity_type:'category',id:c.id,deleted:true,reason:'清理'});await tags.create({category_id:c.id,name:'并发新增',description:'应使预览失效',request_id:uuid()});await assert.rejects(d.apply({preview_id:p.preview_id,request_id:uuid()}),e=>e.code==='PREVIEW_STALE');
 p=await d.preview({entity_type:'tag',id:tag.id,deleted:true,reason:'清理'});const original=f.env.DB.batch;f.env.DB.batch=async ss=>{f.sqlite.prepare('UPDATE tags SET version=version+1 WHERE id=?').run(tag.id);return original(ss);};await assert.rejects(d.apply({preview_id:p.preview_id,request_id:uuid()}),e=>e.code==='PRECONDITION_CHANGED');f.env.DB.batch=original;
 const m=new TagMaintenance(f.env,actor,'web'),availability=await m.previewAvailability({entity_type:'tag',id:tag.id,enabled:false,reason:'并发类别删除'});f.env.DB.batch=async ss=>{f.sqlite.prepare('UPDATE tag_categories SET deleted=1,enabled=0,version=version+1 WHERE id=?').run(c.id);return original(ss);};await assert.rejects(m.applyAvailability({preview_id:availability.preview_id,request_id:uuid()}),e=>e.code==='PRECONDITION_CHANGED');f.env.DB.batch=original;
 p=await d.preview({entity_type:'tag',id:tag.id,deleted:true,reason:'清理'});f.sqlite.prepare('UPDATE members SET frozen=1,auth_epoch=auth_epoch+1 WHERE id=?').run(actor.id);await assert.rejects(d.apply({preview_id:p.preview_id,request_id:uuid()}),e=>e.code==='PRECONDITION_CHANGED');assert.equal((await tags.definition(tag.id)).deleted,0);
});
