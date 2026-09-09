import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {TaskReview} from '../app/server/task-review.ts';
import {recordTaskContext} from '../app/server/mcp-tasks.ts';
import {startAttempt,finishAttempt,listCalls,getCall,cleanupJournal,registerJournalFields} from '../app/server/mcp-journal.ts';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {Tags} from '../app/server/tags.ts';
import {TagDeletion} from '../app/server/tag-deletion.ts';

const atDays=days=>new Date(Date.now()-days*86400000).toISOString();
function admin(f){f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';return new TaskReview(f.env,f.actor);}
async function call(f,tool,args,result,outcome='success'){const a=await startAttempt(f.env,f.actor,tool,args);assert.equal(a.stored,true);await finishAttempt(f.env,a,outcome,null,result);return a.id;}

test('a vocabulary deletion task retains an explicit link to its removed definition',async t=>{
 const f=fixture();t.after(f.close);const review=admin(f),tags=new Tags(f.env,f.actor,'mcp'),deletion=new TagDeletion(f.env,f.actor,'mcp');
 const category=await tags.createCategory({type:'person',name:'虚构删除产物',request_id:uuid()}),task=await recordTaskContext(f.env,f.actor,{purpose:'清理虚构词库',request_id:uuid()});
 const p=await deletion.preview({entity_type:'category',id:category.id,deleted:true,reason:'清理测试'}),input={preview_id:p.preview_id,request_id:uuid()},result=await deletion.apply(input);
 registerJournalFields('apply_tag_deletion',['preview_id','request_id']);await call(f,'apply_tag_deletion',{...input,task_id:task.task_id},result);
 const detail=await review.detail({id:task.task_id});assert.equal(detail.artifacts[0].id,category.id);assert.equal(detail.artifacts[0].available,true);assert.equal(detail.artifacts[0].current_version,2);assert.ok(!(await tags.categories('person')).categories.some(c=>c.id===category.id));
});
test('explicit task and attempt identities, retry receipts and current artifacts remain distinct',async t=>{
 const f=fixture();t.after(f.close);const review=admin(f),archives=new Archives(f.env,f.actor,'mcp'),observations=new Observations(f.env,f.actor,'mcp');
 const archive=await archives.create({type:'person',name:'虚构任务档案',request_id:uuid()}),request={purpose:'整理虚构资料',request_id:uuid()},task=await recordTaskContext(f.env,f.actor,request);
 const retry=await recordTaskContext(f.env,f.actor,request);assert.equal(retry.task_id,task.task_id);assert.equal(retry.replayed,true);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mcp_tasks').get().n,1);
 const payload={archive_id:archive.id,body:'虚构产物',request_id:uuid()},created=await observations.create(payload),first=await call(f,'create_observation',{...payload,task_id:task.task_id},created),replayed=await observations.create(payload);
 await call(f,'create_observation',{...payload,task_id:task.task_id},replayed);await call(f,'list_archives',{}, {count:1});
 const wrong=await call(f,'list_archives',{task_id:uuid()},{count:1});assert.equal((await getCall(f.env,f.actor,wrong)).call.task_id,null);
 let detail=await review.detail({id:task.task_id});assert.equal(detail.calls.length,2);assert.equal(detail.task.original_request_state,'unknown');assert.equal(detail.task.model_state,'unknown');assert.equal(detail.artifacts[0].current_version,1);
 await observations.update({id:created.id,expected_version:1,body:'产物后续修改',occurred_at:null,request_id:uuid()});await observations.setDeleted({id:created.id,expected_version:2,request_id:uuid()},true);
 detail=await review.detail({id:task.task_id,limit:1});assert.equal(detail.artifacts[0].changed_since,true);assert.equal(detail.artifacts[0].deleted,true);assert.ok(detail.artifacts[0].url.includes(created.id));assert.ok(detail.next_cursor);
 const second=await review.detail({id:task.task_id,limit:1,before:detail.next_cursor});assert.notEqual(detail.calls[0].id,second.calls[0].id);assert.equal(second.next_cursor,null);
 const stats=await review.statistics({});assert.equal(stats.totals.calls,4);assert.equal(stats.totals.observations_created,1);assert.equal(stats.tasks_created,1);assert.equal(stats.association_coverage,.5);
 const linked=await listCalls(f.env,f.actor,{association:'linked'});assert.equal(linked.calls.length,2);assert.equal((await getCall(f.env,f.actor,first)).call.request_id,payload.request_id);
 assert.equal((await review.list({query:'整理',tool:'create_observation'})).tasks.length,1);assert.equal((await review.list({query:'其他'})).tasks.length,0);
 assert.throws(()=>new TaskReview(f.env,{...f.actor,role:'member'}),e=>e.status===403);await assert.rejects(getCall(f.env,{...f.actor,role:'member'},first),e=>e.status===403);
});
test('task source copies are bounded, redacted and gated by source availability without invented model facts',async t=>{
 const f=fixture();t.after(f.close);const review=admin(f),a=await new Archives(f.env,f.actor,'mcp').create({type:'person',name:'虚构来源档案',request_id:uuid()}),o=await new Observations(f.env,f.actor,'mcp').create({archive_id:a.id,body:'虚构来源',request_id:uuid()}),secret='cts_'+'c'.repeat(64);
 await new Observations(f.env,f.actor,'mcp').detail(o.id);
 const task=await recordTaskContext(f.env,f.actor,{purpose:'整理来源',original_request:`原话 ${secret}`,source_material:'密码=不可留下\n正常资料',reported_model:'Agent 自报测试模型',archive_id:a.id,source_references:[{kind:'observation',note:'材料摘录',observation_id:o.id,content_version:1}],request_id:uuid()});
 const detail=await review.detail({id:task.task_id});assert.ok(!JSON.stringify(detail).includes(secret));assert.ok(!JSON.stringify(detail).includes('不可留下'));assert.equal(detail.task.model_state,'agent_reported');assert.equal(detail.task.source_references.length,1);await new Observations(f.env,f.actor,'mcp').setDeleted({id:o.id,expected_version:1,request_id:uuid()},true);assert.equal((await review.detail({id:task.task_id})).task.source_references.length,1,'admin can still read a deleted source under current policy');
 f.sqlite.prepare('UPDATE mcp_tasks SET source_references_json=? WHERE id=?').run(JSON.stringify([{kind:'observation',note:'不可泄露副本',observation_id:uuid(),content_version:1}]),task.task_id);
 const hidden=await review.detail({id:task.task_id});assert.equal(hidden.task.body_state,'source_restricted');assert.equal(hidden.task.original_request,null);assert.equal(hidden.task.purpose,null);assert.deepEqual(hidden.task.source_references,[]);assert.equal((await review.list({})).tasks[0].purpose,null);assert.equal((await review.list({query:'整理来源'})).tasks.length,0);
 registerJournalFields('source_test',['body','source_references']);const id=await call(f,'source_test',{body:`Bearer ${secret}`,source_references:[]},{id:o.id,version:1,changed:true,body:secret,uploadUrl:'https://secret.invalid'}),row=await getCall(f.env,f.actor,id);
 assert.ok(!JSON.stringify(row).includes(secret));assert.deepEqual(row.result_metadata,{id:o.id,version:1,changed:true});
 await assert.rejects(recordTaskContext(f.env,f.actor,{purpose:'x',source_material:'x'.repeat(100001),request_id:uuid()}));
});
test('30 day bodies and 180 day metadata expire independently; anonymous rollups survive retry without deleting business records',async t=>{
 const f=fixture();t.after(f.close);const review=admin(f),archive=await new Archives(f.env,f.actor,'mcp').create({type:'person',name:'长期档案',request_id:uuid()}),observation=await new Observations(f.env,f.actor,'mcp').create({archive_id:archive.id,body:'长期观察不得被清理',request_id:uuid()});
 const task=await recordTaskContext(f.env,f.actor,{purpose:'到期任务',original_request:'到期原话',source_material:'到期副本',reported_model:'到期自报模型',request_id:uuid()}),id=await call(f,'create_observation',{task_id:task.task_id},{...observation,changed:true});
 f.sqlite.prepare('UPDATE mcp_tasks SET created_at=?').run(atDays(31));f.sqlite.prepare('UPDATE mcp_calls SET started_at=?').run(atDays(31));
 assert.equal((await review.detail({id:task.task_id})).task.original_request,null);assert.equal((await getCall(f.env,f.actor,id)).parameters,null);
 await cleanupJournal(f.env);let row=f.sqlite.prepare('SELECT * FROM mcp_tasks').get();assert.equal(row.original_request,null);assert.equal(row.source_material,null);assert.equal(row.reported_model,null);assert.equal(row.original_request_provided,1);assert.equal((await getCall(f.env,f.actor,id)).result_metadata.id,observation.id);
 f.sqlite.prepare('UPDATE mcp_tasks SET created_at=?').run(atDays(181));f.sqlite.prepare('UPDATE mcp_calls SET started_at=?').run(atDays(181));
 const nativeBatch=f.env.DB.batch;f.env.DB.batch=statements=>nativeBatch([...statements,f.env.DB.prepare('INSERT INTO missing_cleanup_table VALUES(1)')]);await assert.rejects(cleanupJournal(f.env));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mcp_daily_usage').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mcp_calls').get().n,1);f.env.DB.batch=nativeBatch;
 await cleanupJournal(f.env);await cleanupJournal(f.env);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mcp_calls').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mcp_tasks').get().n,0);
 const rollup=f.sqlite.prepare('SELECT * FROM mcp_daily_usage').get();assert.equal(rollup.calls,1);assert.equal(rollup.observations_created,1);assert.ok(!JSON.stringify(rollup).includes(f.actor.id));assert.ok(!JSON.stringify(rollup).includes(observation.id));
 const stats=await review.statistics({from:atDays(190)});assert.equal(stats.totals.calls,1);assert.equal(stats.tasks_created,1);assert.equal(stats.archived_daily.length,1);assert.equal((await new Observations(f.env,f.actor,'web').get(observation.id)).body,'长期观察不得被清理');
 await assert.rejects(review.detail({id:task.task_id}),e=>e.status===404);
});
test('tag creation, reuse, replay and bounded partial migration metadata describe distinct effects',async t=>{
 const f=fixture();t.after(f.close);const review=admin(f),tags=new Tags(f.env,f.actor,'mcp'),category=await tags.createCategory({type:'person',name:'计数类别',request_id:uuid()}),input={category_id:category.id,name:'计数标签',description:'虚构计数特征',request_id:uuid()},created=await tags.create(input);
 await call(f,'create_tag',input,created);const reused=await tags.create({...input,request_id:uuid()});await call(f,'create_tag',{},reused,'no_change');await call(f,'create_tag',input,await tags.create(input),'no_change');
 const archive=await new Archives(f.env,f.actor,'mcp').create({type:'person',name:'绑定计数',request_id:uuid()}),binding={archive_id:archive.id,expected_version:1,changes:[{tag_id:created.id,action:'add',evidence:[{kind:'member_instruction',note:'虚构独立计数材料'}]}],request_id:uuid()},bound=await tags.batch(binding);await call(f,'update_archive_tags',binding,bound);await call(f,'update_archive_tags',binding,await tags.batch(binding),'no_change');
 const stats=await review.statistics({});assert.equal(stats.totals.tags_created,1);assert.equal(stats.totals.tags_reused,1);assert.equal(stats.totals.tags_added,1);
 const id=await call(f,'apply_tag_migration',{}, {from_tag_id:created.id,to_tag_id:uuid(),completed:[{archive_id:archive.id,version:2,private_body:'must not enter metadata'}],remaining_open:3,preserved_closed:1,changed:true}),result=(await getCall(f.env,f.actor,id)).result_metadata;assert.deepEqual(result.completed,[{archive_id:archive.id,version:2}]);assert.equal(result.remaining_open,3);assert.equal(result.preserved_closed,1);
});
