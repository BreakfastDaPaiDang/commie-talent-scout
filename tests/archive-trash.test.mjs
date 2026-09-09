import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {Reading} from '../app/server/reading.ts';
import {Drafts} from '../app/server/drafts.ts';
import {Images} from '../app/server/images.ts';
import {Avatars} from '../app/server/avatars.ts';
import {recordTaskContext} from '../app/server/mcp-tasks.ts';
import {Tags} from '../app/server/tags.ts';
import {TagMaintenance} from '../app/server/tag-maintenance.ts';
import {TaskReview} from '../app/server/task-review.ts';
import {readFileSync} from 'node:fs';
import {cleanupImages} from '../app/server/images.ts';

function admin(f){f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);return {...f.actor,role:'admin'};}
const state=async(s,id,deleted)=>s.setDeleted({id,expected_version:(await s.get(id)).version,request_id:uuid()},deleted);

test('admin can recover a deleted closed archive with its status, ownership and observation history intact',async t=>{
 const f=fixture();t.after(f.close);const actor=admin(f),s=new Archives(f.env,actor,'web'),o=new Observations(f.env,actor,'web');
 const a=await s.create({type:'person',name:'虚构可恢复档案',request_id:uuid()}),record=await o.create({archive_id:a.id,body:'保留正文',request_id:uuid()});
 await o.update({id:record.id,expected_version:1,body:'保留新正文',occurred_at:null,request_id:uuid()});
 await o.setDeleted({id:record.id,expected_version:2,request_id:uuid()},true);
 await s.setState({id:a.id,expected_version:(await s.get(a.id)).version,status:'已弃用',member_ids:[actor.id],request_id:uuid()});
 const before=await s.detail(a.id),history=await o.versions({id:record.id});
 const input={id:a.id,expected_version:before.archive.version,request_id:uuid()},deleted=await s.setDeleted(input,true);
 assert.equal(deleted.deleted,true);assert.equal((await s.list({type:'person'})).archives.length,0);
 assert.equal((await s.list({type:'person',deleted:true})).archives[0].id,a.id);
 assert.equal((await s.setDeleted(input,true)).replayed,true);
 await assert.rejects(s.reopen({id:a.id,expected_version:deleted.version,status:'视奸观察',member_ids:[],request_id:uuid()}),{code:'ARCHIVE_DELETED'});
 await state(s,a.id,false);const after=(await s.detail(a.id)).archive;
 assert.equal(after.deleted,false);assert.equal(after.closed,true);assert.equal(after.status,before.archive.status);assert.deepEqual(after.bindings,before.archive.bindings);
 assert.deepEqual(await o.versions({id:record.id}),history);assert.equal((await o.get(record.id)).deleted,true);
 assert.equal((await s.list({type:'person'})).archives.length,1);
});

test('trash preserves tag meaning and evidence, leaves impact lists, and invalidates definition previews',async t=>{
 const f=fixture();t.after(f.close);const actor=admin(f),s=new Archives(f.env,actor,'web'),tags=new Tags(f.env,actor,'web'),m=new TagMaintenance(f.env,actor,'web');
 const a=await s.create({type:'person',name:'虚构标签档案',request_id:uuid()}),category=await tags.createCategory({type:'person',name:'虚构删除类别',request_id:uuid()}),tag=await tags.create({category_id:category.id,name:'原词义',description:'原来的说明',request_id:uuid()});
 await tags.batch({archive_id:a.id,expected_version:1,changes:[{tag_id:tag.id,action:'add',evidence:[{kind:'member_instruction',note:'保留绑定依据'}]}],request_id:uuid()});
 const before=(await s.detail(a.id)).archive.tags,change={entity_type:'tag',id:tag.id,category_id:category.id,name:'澄清后的词义',description:'新的说明',reason:'澄清原含义'},preview=await m.preview(change);
 await state(s,a.id,true);
 await assert.rejects(m.apply({preview_id:preview.preview_id,request_id:uuid()}),{code:'PREVIEW_STALE'});
 assert.deepEqual((await m.detail({entity_type:'tag',id:tag.id})).counts,{archives:0,bindings:0,open:0,closed:0});assert.equal((await m.bindings({entity_type:'tag',id:tag.id})).archives.length,0);
 const fresh=await m.preview(change);await m.apply({preview_id:fresh.preview_id,request_id:uuid()});
 assert.deepEqual((await s.detail(a.id)).archive.tags,before);assert.deepEqual((await tags.bindings(a.id)).tags,before);
 assert.equal((await s.list({type:'person',deleted:true})).archives[0].tag_summary.tags[0].name,'原词义');
 await state(s,a.id,false);const restored=(await s.detail(a.id)).archive;
 assert.equal(restored.closed,false);assert.equal(restored.tags[0].name,'澄清后的词义');assert.deepEqual(restored.tags[0].evidence,before[0].evidence);
});

test('retained attachments survive cleanup and old task copies are hidden until archive restoration',async t=>{
 const f=fixture();t.after(f.close);const actor=admin(f),s=new Archives(f.env,actor,'web'),obs=new Observations(f.env,actor,'mcp'),images=new Images(f.env,actor,'web'),review=new TaskReview(f.env,actor);
 const a=await s.create({type:'person',name:'虚构图片恢复',request_id:uuid()}),png=readFileSync(new URL('./fixtures/images/shapes.png',import.meta.url)),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',png)).toString('hex');
 const ready=await images.prepare({purpose:'observation',archive_id:a.id,mime_type:'image/png',byte_size:png.length,sha256});
 await Images.receive(f.env,ready.upload_id,new Request(ready.url,{method:'PUT',headers:{...ready.headers,'Content-Length':String(png.length)},body:png}));
 const o=await obs.create({archive_id:a.id,body:'图片及文字保留',attachment_ids:[ready.attachment_id],request_id:uuid()});await obs.detail(o.id);
 const task=await recordTaskContext(f.env,actor,{purpose:'旧任务副本',source_material:'原始材料副本',archive_id:a.id,source_references:[{kind:'observation',observation_id:o.id,content_version:1,note:'保留来源'}],request_id:uuid()});
 const pending=await images.prepare({purpose:'observation',archive_id:a.id,mime_type:'image/png',byte_size:png.length,sha256});
 await state(s,a.id,true);
 await assert.rejects(new Images(f.env,{...actor,role:'member'},'web').read(ready.attachment_id),e=>e.status===404);
 await assert.rejects(Images.receive(f.env,pending.upload_id,new Request(pending.url,{method:'PUT',headers:{...pending.headers,'Content-Length':String(png.length)},body:png})),{code:'ARCHIVE_DELETED'});
 assert.equal((await review.list({query:'旧任务副本'})).tasks.length,0);const hidden=(await review.detail({id:task.task_id})).task;assert.equal(hidden.body_state,'source_restricted');assert.equal(hidden.source_material,null);assert.deepEqual(hidden.source_references,[]);
 await cleanupImages(f.env,Date.now()+2*86400000);assert.deepEqual(Buffer.from(await (await images.read(ready.attachment_id)).arrayBuffer()),png);
 await state(s,a.id,false);assert.deepEqual((await obs.detail(o.id)).observation.attachments.map(i=>i.id),[ready.attachment_id]);assert.equal((await review.detail({id:task.task_id})).task.source_material,'原始材料副本');
});

test('deletion and restore recheck authority and archive versions atomically against concurrent changes',async t=>{
 const f=fixture();t.after(f.close);const actor=admin(f),s=new Archives(f.env,actor,'web'),obs=new Observations(f.env,actor,'web'),a=await s.create({type:'person',name:'虚构并发删除',request_id:uuid()});
 const realBatch=f.env.DB.batch;let beforeCommit;
 f.env.DB.batch=async statements=>{if(beforeCommit){const action=beforeCommit;beforeCommit=null;await action();}return realBatch(statements);};
 beforeCommit=()=>obs.create({archive_id:a.id,body:'并发发布内容',request_id:uuid()});
 await assert.rejects(s.setDeleted({id:a.id,expected_version:1,request_id:uuid()},true),{code:'PRECONDITION_CHANGED'});assert.equal((await s.get(a.id)).deleted,false);assert.equal((await obs.list({archive_id:a.id})).observations.length,1);
 beforeCommit=()=>f.sqlite.prepare("UPDATE members SET role='member' WHERE id=?").run(actor.id);
 await assert.rejects(state(s,a.id,true),{code:'PRECONDITION_CHANGED'});assert.equal((await s.get(a.id)).deleted,false);
 f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(actor.id);await state(s,a.id,true);
 const old=await s.get(a.id);await assert.rejects(s.setDeleted({id:a.id,expected_version:old.version-1,request_id:uuid()},false),{code:'VERSION_CONFLICT'});
 await state(s,a.id,false);beforeCommit=()=>state(s,a.id,true);
 await assert.rejects(obs.create({archive_id:a.id,body:'不得越过删除提交',request_id:uuid()}),{code:'PRECONDITION_CHANGED'});assert.equal((await obs.list({archive_id:a.id})).observations.length,1);
 assert.equal((await s.events({id:a.id})).events.filter(e=>e.kind==='archive.deleted').length,2);
});

test('deletion hides every normal read even from the author, invalidates old tickets and locks admin writes',async t=>{
 const f=fixture();t.after(f.close);const actor=admin(f);const id=uuid(),credential=uuid();f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,'2026-01-01T00:00:00.000Z')").run(id,id,'原作者');f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'mcp','fixture',1,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')").run(credential,id,uuid());const ordinary={...f.sqlite.prepare('SELECT * FROM members WHERE id=?').get(id),credential_id:credential,credential_kind:'mcp'},s=new Archives(f.env,actor,'web'),reader=new Archives(f.env,ordinary,'mcp'),obs=new Observations(f.env,ordinary,'mcp'),adminObs=new Observations(f.env,actor,'web');
 // The test actor retains ordinary member authority; production authentication supplies fresh roles.
 const a=await s.create({type:'org',name:'虚构隐藏组织',request_id:uuid()}),o=await obs.create({archive_id:a.id,body:'绝不通过旧入口泄露',request_id:uuid()});
 const reading=new Reading(f.env,ordinary),ticket=[...(await reading.deliver((await s.events({id:a.id})).events)).values()][0];
 const draft=new Drafts(f.env,ordinary);await draft.save({archive_id:a.id,expected_version:0,body:'待发布草稿',occurred_at:null,request_id:uuid()});
 const image=new Images(f.env,ordinary,'web'),pending=await image.prepare({purpose:'observation',archive_id:a.id,mime_type:'image/png',byte_size:1,sha256:'0'.repeat(64)});
 await assert.rejects(reader.setDeleted({id:a.id,expected_version:(await s.get(a.id)).version,request_id:uuid()},true),{code:'ADMIN_REQUIRED'});
 await state(s,a.id,true);
 for(const scope of ['all','mine','unread']){const r=await reader.list({type:'org',scope,query:'绝不通过旧入口泄露'});assert.equal(r.archives.length,0);assert.deepEqual(r.counts,{all:0,mine:0,unread:0});}
 await assert.rejects(reader.list({type:'org',deleted:true}),{code:'ADMIN_REQUIRED'});
 for(const action of [()=>reader.detail(a.id),()=>reader.events({id:a.id}),()=>obs.detail(o.id),()=>obs.versions({id:o.id}),()=>obs.list({archive_id:a.id}),()=>obs.timeline({id:a.id}),()=>draft.get(a.id),()=>image.status(pending.upload_id),()=>new Avatars(f.env,ordinary,'web').read('archive',a.id)])await assert.rejects(action,e=>e.status===404);
 assert.equal((await draft.list()).drafts.length,0);assert.equal((await reading.summary()).total,0);assert.equal((await reading.list({})).events.length,0);
 assert.equal((await reading.confirm({tickets:[ticket.ticket]})).confirmed.length,0);
 assert.equal((await adminObs.get(o.id)).editable,false);
 for(const action of [()=>adminObs.create({archive_id:a.id,body:'禁止写入',request_id:uuid()}),()=>new Drafts(f.env,actor).save({archive_id:a.id,expected_version:1,body:'禁止草稿',occurred_at:null,request_id:uuid()}),()=>recordTaskContext(f.env,actor,{archive_id:a.id,purpose:'禁止新任务',request_id:uuid()})])await assert.rejects(action,{code:'ARCHIVE_DELETED'});
 await state(s,a.id,false);assert.equal((await obs.get(o.id)).body,'绝不通过旧入口泄露');assert.equal((await draft.get(a.id)).draft.body,'待发布草稿');
 assert.equal((await reading.confirm({tickets:[ticket.ticket]})).confirmed.length,0,'restoration cannot revive an old receipt');
});
