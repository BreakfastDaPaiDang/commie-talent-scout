import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {InternalResources} from '../app/server/internal-resources.ts';
import {makeResource,allocation,seedLegacy} from './internal-resource-fixture.mjs';
test('internal inventory exists without people; capacities and repeated allocations count distinct people',async t=>{
 const f=fixture();t.after(f.close);const catalog=new InternalResources(f.env,f.actor,'mcp'),r=await makeResource(f,'已确认社内资源',{capacity:0}),a=new Archives(f.env,f.actor,'web');
 assert.equal((await catalog.get(r.id)).used,0);assert.equal((await catalog.get(r.id)).remaining,0);
 const person=await a.create({type:'person',name:'虚构人员',resources:[allocation(r),allocation(r),allocation(r,{usage:'planned'})],request_id:uuid()});
 assert.equal((await catalog.get(r.id)).used,1);assert.equal((await catalog.get(r.id)).planned,0);assert.equal((await catalog.get(r.id)).remaining,0,'actual over-capacity facts are retained');
 const current=await catalog.get(r.id),{id,version,name,type,note,stage_ids,member_ids}=current;const input={id,expected_version:version,name,type,note,stage_ids,member_ids,status:'paused',capacity:null,request_id:uuid()};await catalog.save(input);assert.equal((await catalog.save(input)).replayed,true);assert.equal((await catalog.get(id)).remaining,null);assert.equal((await a.get(person.id)).resources[0].internal_resource.status,'paused');assert.equal((await catalog.history({id})).events.length,2);
 await assert.rejects(catalog.save({...input,request_id:uuid()}),{code:'VERSION_CONFLICT'});
});
test('legacy external links are preserved unchanged and cannot create internal inventory or new contact resources',async t=>{
 const f=fixture();t.after(f.close);const a=new Archives(f.env,f.actor,'web'),org=await a.create({type:'org',name:'外部联系组织',request_id:uuid()}),p=await a.create({type:'person',name:'人物',request_id:uuid()}),old={id:uuid(),name:'旧接触群',type:'群聊',note:'旧联系记录',archive_id:org.id,usage:'active'};seedLegacy(f,p.id,[old]);
 let person=await a.get(p.id);assert.equal(person.resources[0].legacy,true);assert.equal((await new InternalResources(f.env,f.actor,'web').list({})).total,0);
 const body={id:person.id,expected_version:person.version,name:person.name,contacts:[],links:[],request_id:uuid()};assert.equal((await a.update({...body,resources:[old]})).changed,false);assert.equal((await a.update({...body,request_id:uuid()})).changed,false);
 await assert.rejects(a.create({type:'person',name:'不能伪造内部资源',resources:[old],request_id:uuid()}),{code:'INTERNAL_RESOURCE_REQUIRED'});
 await assert.rejects(a.update({...body,resources:[{...old,usage:'planned'}],request_id:uuid()}),{code:'INTERNAL_RESOURCE_REQUIRED'});
 const r=await makeResource(f),linked=allocation(r,{id:old.id});await a.update({...body,resources:[linked],request_id:uuid()});person=await a.get(p.id);assert.equal(person.resources[0].internal_resource.name,'真实社内资源');assert.equal(person.resources[0].legacy,false);assert.equal((await a.events({id:p.id})).events[0].before.resources[0].name,'旧接触群');
});
test('catalog retirement racing a new allocation rolls back archive changes and receipt',async t=>{
 const f=fixture();t.after(f.close);const a=new Archives(f.env,f.actor,'web'),r=await makeResource(f),p=await a.create({type:'person',name:'原始人物',request_id:uuid()}),batch=f.env.DB.batch.bind(f.env.DB);let once=true;f.env.DB.batch=async statements=>{if(once){once=false;f.sqlite.prepare("UPDATE internal_resources SET status='archived',version=version+1 WHERE id=?").run(r.id);}return batch(statements);};const body={id:p.id,expected_version:1,name:'不能部分保存',contacts:[],links:[],resources:[allocation(r)],request_id:uuid()};await assert.rejects(a.update(body),{code:'PRECONDITION_CHANGED'});assert.equal((await a.get(p.id)).name,'原始人物');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM commands WHERE request_id=?').get(body.request_id).n,0);
});
test('frozen credentials cannot modify inventory and injected event failure is atomic',async t=>{
 const f=fixture();t.after(f.close);const s=new InternalResources(f.env,f.actor,'web');f.sqlite.exec("CREATE TRIGGER fail_resource_history BEFORE INSERT ON internal_resource_events BEGIN SELECT RAISE(ABORT,'test event failure'); END;");await assert.rejects(makeResource(f));assert.equal((await s.list({})).total,0);f.sqlite.exec('DROP TRIGGER fail_resource_history');f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.actor.id);await assert.rejects(makeResource(f),{code:'PRECONDITION_CHANGED'});assert.equal((await s.list({})).total,0);
});
