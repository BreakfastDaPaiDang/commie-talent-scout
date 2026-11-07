import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildOverviewPerson,backlogForecast,resourceDistribution,dayMs} from '../app/shared/work-overview.ts';
import {WorkOverview} from '../app/server/work-overview.ts';
import {Archives} from '../app/server/archives.ts';
import {fixture} from './d1-fixture.mjs';

const at='2026-11-07T00:00:00.000Z',time=n=>new Date(Date.parse(at)+n*dayMs).toISOString();
const archive={id:'p',name:'示例',type:'person',status:'个人接触',created_at:time(-40),person_role:'external'};
const events=[{id:'e1',archive_id:'p',seq:1,kind:'archive.created',created_at:time(-11),after:{status:'个人接触'}},{id:'e2',archive_id:'p',seq:2,kind:'archive.state_changed',created_at:time(-9),after:{status:'人事审核'}},{id:'e3',archive_id:'p',seq:3,kind:'archive.state_changed',created_at:time(-5),after:{status:'个人接触'}}];
test('real state changes preserve 2:4:5 durations and a distinct return to contact',()=>{
 const p=buildOverviewPerson(archive,events,[],[],[],at);assert.deepEqual(p.segments.map(s=>s.days),[2,4,5]);assert.deepEqual(p.segments.map(s=>s.type),['contact','review','contact']);assert.equal(p.segments[2].id,'e3');assert.equal(p.history_complete,true);
 const duplicate={...events[1],id:'same',seq:4,created_at:time(-8)};assert.equal(buildOverviewPerson(archive,[...events,duplicate],[],[],[],at).segments.length,3);
});
test('forecast retains overdue people daily, counts exact deadline once and follows new observation',()=>{
 const p=buildOverviewPerson(archive,events,[{id:'o',archive_id:'p',created_at:time(-28),body:'近况',author_name:'作者'}],[],[],at);
 const f=backlogForecast([p],at,5);assert.deepEqual(f.map(v=>v.total),[0,0,1,1,1,1]);
 const overdue=buildOverviewPerson(archive,events,[],[],[],at);assert.deepEqual(backlogForecast([overdue],at,3).map(v=>v.total),[1,1,1,1]);
 const updated=buildOverviewPerson(archive,events,[{id:'new',archive_id:'p',created_at:at,body:'已尝试联系',author_name:'作者'}],[],[],at);assert.equal(backlogForecast([updated],at)[29].total,0);assert.equal(backlogForecast([updated],at)[30].total,1);
});
test('only current task responsibility is used and multiple owners are not guessed',()=>{
 const t={id:'t',archive_id:'p',title:'跟进',owner_id:'m',owner_name:'甲',owner_frozen:false,deadline_at:at};
 assert.equal(buildOverviewPerson(archive,events,[],[],[t],at).owner_name,'甲');assert.equal(buildOverviewPerson(archive,events,[],[],[t,{...t,id:'other',owner_id:'n',owner_name:'乙'}],at).assignment,'conflict');assert.equal(buildOverviewPerson(archive,events,[],[],[{...t,owner_frozen:true}],at).assignment,'unassigned');
});
test('resource count and capacity are separate and unknown capacity remains explicit',()=>{
 const rows=resourceDistribution([{id:'r',name:'群',kind:'群聊',version:1,purposes:['contact','review'],capacity:null,active:true,note:''},{id:'r2',name:'项目',kind:'项目',version:1,purposes:['contact'],capacity:8,active:true,note:''}]);assert.equal(rows[0].count,2);assert.equal(rows[0].capacity,8);assert.equal(rows[0].unknown,1);assert.equal(rows[1].count,1);
});

const resource=()=>({entity:'resource',id:randomUUID(),expected_version:0,request_id:randomUUID(),name:'虚构资源',kind:'群聊',purposes:['contact'],capacity:null,active:true,note:''});
test('resource writes have stable receipts, version conflicts and independent immutable history',async t=>{
 const f=fixture();t.after(f.close);const w=new WorkOverview(f.env,f.actor),a=resource();const first=await w.save(a);assert.equal(first.version,1);assert.equal((await w.save(a)).replayed,true);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_overview_history').get().n,1);
 await assert.rejects(()=>w.save({...a,request_id:randomUUID(),name:'改名'}),e=>e.code==='VERSION_CONFLICT');
 await w.save({...a,request_id:randomUUID(),expected_version:1,purposes:['review']});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_overview_history').get().n,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM internal_resources').get().n,0);
});
test('overview excludes closed/deleted archives and old observations edited today do not reset the timer',async t=>{
 const f=fixture();t.after(f.close);const a=await new Archives(f.env,f.actor,'web').create({type:'person',name:'虚构对象',request_id:randomUUID()});const old=new Date(Date.now()-40*dayMs).toISOString(),o=randomUUID();
 f.sqlite.prepare('UPDATE archives SET created_at=? WHERE id=?').run(old,a.id);
 f.sqlite.prepare('INSERT INTO observations(id,archive_id,author_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(o,a.id,f.actor.id,old,new Date().toISOString());f.sqlite.prepare('INSERT INTO observation_versions(observation_id,version,body,editor_id,created_at) VALUES(?,1,?,?,?)').run(o,'最新编辑文字',f.actor.id,new Date().toISOString());
 const w=new WorkOverview(f.env,f.actor),data=await w.read({type:'person'});assert.equal(data.people[0].last_observation_at,old);assert.ok(data.people[0].due_at<data.as_of);assert.equal(data.people[0].segments[0].observations.length,0);
 f.sqlite.prepare('UPDATE archives SET closed=1 WHERE id=?').run(a.id);assert.equal((await w.read({})).people.length,0);f.sqlite.prepare('UPDATE archives SET closed=0,deleted=1 WHERE id=?').run(a.id);assert.equal((await w.read({})).people.length,0);
});
test('placements bind real archive events, preserve plan/actual distinction and reject closed archives',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web'),a=await archives.create({type:'person',name:'虚构对象',request_id:randomUUID()}),b=await archives.create({type:'person',name:'另一对象',request_id:randomUUID()});const e=f.sqlite.prepare("SELECT id FROM archive_events WHERE archive_id=? AND kind='archive.created'").get(a.id).id;const w=new WorkOverview(f.env,f.actor),r=resource();await w.save(r);
 const p={entity:'placement',id:randomUUID(),expected_version:0,request_id:randomUUID(),archive_id:a.id,event_id:e,resource_ids:[r.id],note:'准备联系',usage:'planned'};await w.save(p);assert.equal((await w.read({})).people.find(x=>x.id===a.id).segments[0].placements[0].usage,'planned');
 await assert.rejects(()=>w.save({...p,id:randomUUID(),request_id:randomUUID(),archive_id:b.id}),e=>e.code==='INVALID_EXPERIENCE');
 f.sqlite.prepare('UPDATE archives SET closed=1 WHERE id=?').run(a.id);await assert.rejects(()=>w.save({...p,request_id:randomUUID(),expected_version:1,usage:'active'}),e=>e.code==='ARCHIVE_CLOSED');
});


test('explicit follow-up tasks appear in overview, claim determines owner, closed tasks stop assigning',async t=>{
 const {WorkTasks}=await import('../app/server/work-tasks.ts');const f=fixture();t.after(f.close);
 const a=await new Archives(f.env,f.actor,'web').create({type:'person',name:'测试跟进',request_id:randomUUID()});
 const work=new WorkTasks(f.env,f.actor,'web'),overview=new WorkOverview(f.env,f.actor);
 const input={archive_id:a.id,title:'联系',purpose:'了解近况',delivery:'新增观察',deadline_at:new Date(Date.now()+7*dayMs).toISOString(),request_id:randomUUID()};
 await work.create(input);assert.equal((await overview.read({})).people[0].tasks.length,0);
 const follow=await work.create({...input,follow_up:true,request_id:randomUUID()});assert.equal((await overview.read({})).people[0].tasks[0].id,follow.id);
 const reused=await work.create({...input,follow_up:true,request_id:randomUUID()});assert.equal(reused.id,follow.id);assert.equal(reused.reused,true);
 await work.claim({id:follow.id,expected_version:1,request_id:randomUUID()});assert.equal((await overview.read({})).people[0].assignment,'assigned');
 f.sqlite.prepare("UPDATE work_tasks SET status='completed' WHERE id=?").run(follow.id);assert.equal((await overview.read({})).people[0].assignment,'unassigned');
});


test('independent resources allow no purpose; deleting removes supply without erasing experience references',async t=>{
 const f=fixture();t.after(f.close);const w=new WorkOverview(f.env,f.actor),r={...resource(),purposes:[]};await w.save(r);
 assert.equal((await w.read({})).resources[0].purposes.length,0);
 await w.save({...r,expected_version:1,purposes:['contact'],request_id:randomUUID()});
 const a=await new Archives(f.env,f.actor,'web').create({type:'person',name:'保留经历',request_id:randomUUID()});const event=f.sqlite.prepare("SELECT id FROM archive_events WHERE archive_id=? AND kind='archive.created'").get(a.id);
 const placement={entity:'placement',id:randomUUID(),expected_version:0,archive_id:a.id,event_id:event.id,resource_ids:[r.id],note:'真实使用过',usage:'active',request_id:randomUUID()};await w.save(placement);
 const deletion={entity:'resource_delete',id:r.id,expected_version:2,request_id:randomUUID()};await w.save(deletion);assert.equal((await w.save(deletion)).replayed,true);
 const data=await w.read({});assert.equal(data.resources[0].deleted,true);assert.equal(resourceDistribution(data.resources)[0].count,0);assert.equal(data.people[0].segments[0].placements[0].resource_ids[0],r.id);assert.equal(data.people[0].segments[0].placements[0].note,'真实使用过');
 await assert.rejects(()=>w.save({...r,expected_version:3,request_id:randomUUID()}),e=>e.code==='RESOURCE_DELETED');
 await w.save({...placement,expected_version:1,note:'补充原记录',request_id:randomUUID()});
 await w.save({...placement,expected_version:2,resource_ids:[],request_id:randomUUID()});
 await assert.rejects(()=>w.save({...placement,expected_version:3,request_id:randomUUID()}),e=>e.code==='RESOURCE_UNAVAILABLE');
 const history=f.sqlite.prepare("SELECT after_json FROM work_overview_history WHERE entity_type='resource_delete'").get();assert.equal(JSON.parse(history.after_json).deleted,true);
});
