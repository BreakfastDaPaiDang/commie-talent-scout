import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Tags} from '../app/server/tags.ts';
import {TagMaintenance} from '../app/server/tag-maintenance.ts';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';

async function seed(f){const tags=new Tags(f.env,f.actor,'web'),archives=new Archives(f.env,f.actor,'web'),maintenance=new TagMaintenance(f.env,f.actor,'web');const category=await tags.createCategory({type:'person',name:'虚构维护',request_id:uuid()}),tag=await tags.create({category_id:category.id,name:'原词义',description:'用于虚构维护验收',request_id:uuid()}),ids=[];
 for(const name of ['开启甲','开启乙','关闭丙']){const a=await archives.create({type:'person',name,request_id:uuid()});ids.push(a.id);await tags.batch({archive_id:a.id,expected_version:1,changes:[{tag_id:tag.id,action:'add'}],request_id:uuid()});if(name==='关闭丙')await archives.setState({id:a.id,expected_version:2,status:'已弃用',member_ids:[],request_id:uuid()});}
 const change={entity_type:'tag',id:tag.id,category_id:category.id,name:'明确词义',description:'澄清使用范围，维持原特征',reason:'修正不清楚的措辞'};
 return {tags,archives,maintenance,category,tag,ids,change};
}
test('ordinary member previews impact, changes public meaning with immutable history and closed snapshot, and replay does not change archive activity',async t=>{
 const f=fixture();t.after(f.close);const {maintenance:m,archives:s,tag,ids,change}=await seed(f),before=f.sqlite.prepare('SELECT id,version,updated_at FROM archives ORDER BY id').all(),events=f.sqlite.prepare('SELECT count(*) n FROM archive_events').get().n;
 const p=await m.preview(change);assert.deepEqual(p.counts,{archives:3,bindings:3,open:2,closed:1});assert.deepEqual(p.diff.map(d=>d.field),['name','description']);
 const input={preview_id:p.preview_id,request_id:uuid()},saved=await m.apply(input);assert.equal(saved.version,2);assert.equal((await m.apply(input)).replayed,true);
 assert.deepEqual(f.sqlite.prepare('SELECT id,version,updated_at FROM archives ORDER BY id').all(),before);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM archive_events').get().n,events);
 assert.equal((await s.detail(ids[0])).archive.tags[0].name,'明确词义');assert.equal((await s.detail(ids[2])).archive.tags[0].name,'原词义');
 const detail=await m.detail({entity_type:'tag',id:tag.id,limit:1});assert.equal(detail.history[0].version,2);assert.equal(detail.history[0].definition.reason,change.reason);assert.equal(detail.next_cursor,2);
 const old=await m.detail({entity_type:'tag',id:tag.id,limit:1,before:detail.next_cursor});assert.equal(old.history[0].definition.name,'原词义');assert.equal(old.next_cursor,null);
 const first=await m.bindings({entity_type:'tag',id:tag.id,closed:'open',limit:1}),second=await m.bindings({entity_type:'tag',id:tag.id,closed:'open',limit:1,before:first.next_cursor});assert.equal(first.archives.length,1);assert.equal(second.archives.length,1);assert.notEqual(first.archives[0].id,second.archives[0].id);assert.equal(second.next_cursor,null);
 const noop=await m.preview(change);assert.equal(noop.changed,false);await m.apply({preview_id:noop.preview_id,request_id:uuid()});assert.equal((await m.detail({entity_type:'tag',id:tag.id})).history.length,2);
});
test('new bindings, concurrent definitions, lifecycle, deleted evidence, freeze and cross-member previews reject stale writes',async t=>{
 const f=fixture();t.after(f.close);const {maintenance:m,tags,archives:s,tag,ids,change}=await seed(f),apply=p=>m.apply({preview_id:p.preview_id,request_id:uuid()});
 let p=await m.preview(change);await tags.batch({archive_id:ids[0],expected_version:2,changes:[{tag_id:tag.id,action:'remove'}],request_id:uuid()});await assert.rejects(apply(p),e=>e.code==='PREVIEW_STALE');
 p=await m.preview(change);const other=await m.preview({...change,name:'其他明确词义'});await apply(other);await assert.rejects(apply(p),e=>e.code==='PREVIEW_STALE');
 p=await m.preview(change);await s.setState({id:ids[1],expected_version:2,status:'已弃用',member_ids:[],request_id:uuid()});await assert.rejects(apply(p),e=>e.code==='PREVIEW_STALE');
 p=await m.preview(change);await assert.rejects(new TagMaintenance(f.env,{...f.actor,id:uuid()},'web').apply({preview_id:p.preview_id,request_id:uuid()}),e=>e.code==='PREVIEW_EXPIRED');
 f.sqlite.prepare('UPDATE members SET frozen=1,auth_epoch=auth_epoch+1 WHERE id=?').run(f.actor.id);await assert.rejects(apply(p),e=>e.code==='PRECONDITION_CHANGED');assert.equal((await m.detail({entity_type:'tag',id:tag.id})).definition.name,'其他明确词义');
});
test('category impact pages archive groups and evidence access follows current deletion and role, including closed snapshots',async t=>{
 const f=fixture();t.after(f.close);const {maintenance:m,tags,archives:s,category,tag,ids,change}=await seed(f),obs=new Observations(f.env,f.actor,'web');
 const observation=await obs.create({archive_id:ids[0],body:'作者私有材料',request_id:uuid()});await tags.batch({archive_id:ids[0],expected_version:3,changes:[{tag_id:tag.id,action:'evidence',evidence:[{kind:'observation',note:'派生隐私说明',observation_id:observation.id,content_version:1}]}],request_id:uuid()});
 const p=await m.preview(change);await obs.setDeleted({id:observation.id,expected_version:1,request_id:uuid()},true);await assert.rejects(m.apply({preview_id:p.preview_id,request_id:uuid()}),e=>e.code==='PREVIEW_STALE');
 const other=new TagMaintenance(f.env,{...f.actor,id:uuid()},'web'),query={entity_type:'category',id:category.id};assert.equal((await other.detail(query)).counts.archives,2);assert.ok(!JSON.stringify(await other.bindings(query)).includes('派生隐私说明'));assert.ok(!JSON.stringify(await other.detail(query)).includes('impact_version'),'internal revisions must not reveal hidden binding activity');
 const admin=new TagMaintenance(f.env,{...f.actor,id:uuid(),role:'admin'},'web');assert.equal((await admin.detail(query)).counts.archives,3);assert.ok(JSON.stringify(await admin.bindings(query)).includes('派生隐私说明'));
 const categoryPreview=await m.preview({...query,name:'虚构澄清类别',description:'同一类别的解释',color:'blue',reason:'明确类别名称'});assert.equal(categoryPreview.counts.archives,3);await m.apply({preview_id:categoryPreview.preview_id,request_id:uuid()});
 assert.equal((await s.detail(ids[1])).archive.tags[0].category_name,'虚构澄清类别');assert.equal((await s.detail(ids[2])).archive.tags[0].category_name,'虚构维护');assert.equal((await s.detail(ids[2])).archive.tags[0].color,'blue');
 await obs.setDeleted({id:observation.id,expected_version:2,request_id:uuid()},false);assert.equal((await other.detail(query)).counts.archives,3);
});
