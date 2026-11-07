import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {WorkOverview} from '../app/server/work-overview.ts';
import {resourceDistribution,buildOverviewPerson,dayMs} from '../app/shared/work-overview.ts';

async function setup(f){const archives=new Archives(f.env,f.actor,'web'),obs=new Observations(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'web'),overview=new WorkOverview(f.env,f.actor);const a=await archives.create({type:'person',name:'边界测试',request_id:id()});return {archives,obs,tasks,overview,a};}
const deadline='2099-01-01T00:00:00.000Z';
const white=o=>({entity:'white_resource',id:id(),expected_version:0,observation_id:o.id,resource_id:null,capacity:null,request_id:id()});

test('white resources are explicit review observations, resolve to one entity and retain both sources',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f);
 const early=await s.obs.create({archive_id:s.a.id,body:'接触阶段',request_id:id()});
 await assert.rejects(s.overview.save(white(early)),{code:'WHITE_NOT_ELIGIBLE'});
 await s.tasks.refer({archive_id:s.a.id,expected_version:(await s.archives.get(s.a.id)).version,deadline_at:deadline,request_id:id()});
 const o1=await s.obs.create({archive_id:s.a.id,body:'审核期间已完成接洽，资源待登记',request_id:id()}),o2=await s.obs.create({archive_id:s.a.id,body:'另一次审核接洽',request_id:id()});
 assert.equal((await s.overview.read({})).white_resources.length,0);
 const w1=white(o1),w2=white(o2);await s.overview.save(w1);await s.overview.save(w2);assert.equal((await s.overview.save(w1)).replayed,true);
 await assert.rejects(s.overview.save(white(o1)),{code:'WHITE_ALREADY_REGISTERED'});
 let data=await s.overview.read({});assert.equal(resourceDistribution(data.resources,data.white_resources)[0].count,2);
 const r={entity:'resource',id:id(),expected_version:0,name:'同一个社内群',kind:'群聊',purposes:['contact','review'],capacity:5,active:true,note:'',request_id:id()};await s.overview.save(r);
 for(const w of [w1,w2])await s.overview.save({...w,expected_version:1,resource_id:r.id,request_id:id()});
 data=await s.overview.read({});const dist=resourceDistribution(data.resources,data.white_resources);assert.equal(dist.length,1);assert.equal(dist[0].id,'contact+review');assert.equal(dist[0].count,1);assert.equal(dist[0].capacity,5);assert.notEqual(dist[0].color,'#ffffff');
 assert.deepEqual(data.white_resources.map(w=>w.observation_id).sort(),[o1.id,o2.id].sort());
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_overview_history WHERE entity_type=?').get('white_resource').n,4);
 await s.overview.save({...w1,expected_version:2,resource_id:r.id,removed:true,request_id:id()});
 assert.equal(resourceDistribution((await s.overview.read({})).resources,(await s.overview.read({})).white_resources)[0].count,1);
 await s.overview.save({entity:'resource_delete',id:r.id,expected_version:1,request_id:id()});await s.overview.save({...w2,expected_version:2,resource_id:r.id,removed:true,request_id:id()});assert.equal(resourceDistribution((await s.overview.read({})).resources,(await s.overview.read({})).white_resources).length,0);
});

test('white registration rejects an already linked stage, and deleted source observations leave the live chart',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f);await s.tasks.refer({archive_id:s.a.id,expected_version:1,deadline_at:deadline,request_id:id()});
 const o=await s.obs.create({archive_id:s.a.id,body:'审核观察',request_id:id()}),w=white(o);await s.overview.save(w);
 await s.obs.setDeleted({id:o.id,expected_version:1,request_id:id()},true);assert.equal((await s.overview.read({})).white_resources.length,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_overview_white_resources').get().n,1);
 const r={entity:'resource',id:id(),expected_version:0,name:'已登记群',kind:'群聊',purposes:['review'],capacity:null,active:true,note:'',request_id:id()};await s.overview.save(r);
 const segment=(await s.overview.read({})).people[0].segments.at(-1);
 await s.overview.save({entity:'placement',id:id(),expected_version:0,archive_id:s.a.id,event_id:segment.id,resource_ids:[r.id],note:'',usage:'active',request_id:id()});
 const o2=await s.obs.create({archive_id:s.a.id,body:'资源已对接',request_id:id()});await assert.rejects(s.overview.save(white(o2)),{code:'WHITE_NOT_ELIGIBLE'});
});

test('current need changes preserve profile and observation timer, conflict rather than overwrite, and replay safely',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),before=(await s.overview.read({})).people[0],input={entity:'current_need',id:s.a.id,expected_version:1,current_need:'需要参与写作',request_id:id()};
 await s.overview.save(input);const after=(await s.overview.read({})).people[0];assert.equal(after.current_need,input.current_need);assert.equal(after.name,before.name);assert.equal(after.due_at,before.due_at);
 await assert.rejects(s.overview.save({...input,request_id:id()}),{code:'VERSION_CONFLICT'});
 await s.overview.save({...input,expected_version:2,current_need:'',request_id:id()});assert.equal((await s.overview.save(input)).replayed,true);assert.equal((await s.archives.get(s.a.id)).current_need,'');
});

for(const source of ['web','mcp'])test(`${source}: manual follow-up needs a fresh current-round record; failed contact stays open; generic work stays independent`,async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),tasks=new WorkTasks(f.env,f.actor,source),old=await s.obs.create({archive_id:s.a.id,body:'以前的观察',request_id:id()});
 f.sqlite.prepare('UPDATE observations SET created_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z',old.id);
 const task=await tasks.create({archive_id:s.a.id,follow_up:true,title:'了解近况',purpose:'联系',delivery:'观察',deadline_at:deadline,request_id:id()});await tasks.claim({id:task.id,expected_version:1,request_id:id()});
 const input={id:task.id,expected_version:2,result_kind:'completed',result_text:'已联系',references:[{observation_id:old.id,content_version:1}],request_id:id()};
 await s.obs.update({id:old.id,expected_version:1,body:'今天编辑旧观察',occurred_at:null,request_id:id()});
 await assert.rejects(tasks.complete({...input,references:[{observation_id:old.id,content_version:2}]}),{code:'CURRENT_ROUND_OBSERVATION_REQUIRED'});
 const fresh=await s.obs.create({archive_id:s.a.id,body:'本轮未联系到',request_id:id()});input.references=[{observation_id:fresh.id,content_version:1}];
 await assert.rejects(tasks.complete({...input,result_kind:'unable_to_contact'}),{code:'NEXT_CONTACT_REQUIRED'});
 const attempt={...input,result_kind:'unable_to_contact',next_contact_at:deadline};const result=await tasks.complete(attempt);assert.equal(result.status,'open');assert.equal((await tasks.complete(attempt)).replayed,true);
 const done=await tasks.complete({...input,expected_version:3,request_id:id()});assert.equal(done.status,'completed');
 const reopened=await tasks.reopen({id:task.id,expected_version:4,deadline_at:deadline,owner_mode:'keep',request_id:id()});
 f.sqlite.prepare('UPDATE observations SET created_at=? WHERE id=?').run('2021-01-01T00:00:00.000Z',fresh.id);
 await assert.rejects(tasks.complete({...input,expected_version:reopened.version,request_id:id()}),{code:'CURRENT_ROUND_OBSERVATION_REQUIRED'});
 const latest=await s.obs.create({archive_id:s.a.id,body:'重开之后联系',request_id:id()});await tasks.complete({...input,expected_version:reopened.version,references:[{observation_id:latest.id,content_version:1}],request_id:id()});
 const create=()=>tasks.create({archive_id:s.a.id,title:'协作拆分',purpose:'提供支持',delivery:'交代成果',deadline_at:deadline,request_id:id()});const [one,two]=[await create(),await create()];assert.notEqual(one.id,two.id);await tasks.claim({id:one.id,expected_version:1,request_id:id()});assert.equal((await tasks.complete({...input,id:one.id,expected_version:2,references:[],request_id:id()})).status,'completed');
 assert.equal((await s.overview.read({})).people[0].assignment,'unassigned');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mutation_guards').get().n,0);
});

test('backfilled observations belong to occurrence stage but reset the timer on submission',()=>{
 const at='2026-11-07T00:00:00.000Z',a={id:'p',name:'测试',type:'person',status:'人事审核',person_role:'external',created_at:'2026-09-01T00:00:00.000Z'};
 const events=[{id:'c',archive_id:'p',seq:1,created_at:a.created_at,kind:'archive.created',after:{status:'个人接触'}},{id:'r',archive_id:'p',seq:2,created_at:'2026-10-01T00:00:00.000Z',kind:'archive.state_changed',after:{status:a.status}}];
 const p=buildOverviewPerson(a,events,[{id:'o',archive_id:'p',created_at:at,occurred_at:'2026-09-20T00:00:00.000Z',body:'补记',author_name:'甲'}],[],[],at);assert.equal(p.segments[0].observations.length,1);assert.equal(p.segments[1].observations.length,0);assert.equal(p.due_at,new Date(Date.parse(at)+30*dayMs).toISOString());
});
