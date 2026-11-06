import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {personnelMap as detailedMap} from '../app/server/personnel-map.ts';
const personnelMap=(env,actor,input)=>detailedMap(env,actor,{group_by:'status',...input});
import {InternalResources} from '../app/server/internal-resources.ts';
import {statistics} from '../app/server/statistics.ts';
import {personnelAttention,reception} from '../app/shared/personnel-signals.ts';
import {readStatisticsView,writeStatisticsView} from '../app/shared/statistics.ts';
import {readPersonnelQuery,writePersonnelQuery,readPersonnelView,writePersonnelView} from '../app/shared/personnel-view.ts';
import {makeResource,allocation,seedLegacy} from './internal-resource-fixture.mjs';
const update=(s,a,resources)=>s.update({id:a.id,expected_version:a.version,name:a.name,contacts:a.contacts,links:a.links,resources,request_id:uuid()});

test('legacy contact membership never conceals missing internal reception; unavailable and stable people are distinct',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),p=await s.create({type:'person',name:'待安排社员',status:'已入伙',request_id:uuid()});
 seedLegacy(f,p.id,[{id:uuid(),name:'外部联系群',type:'群聊',note:'只是联系',archive_id:null,usage:'active'}]);
 let map=await personnelMap(f.env,f.actor,{}),layer=map.layers.find(l=>l.id==='已入伙');assert.equal(layer.unplaced,1);assert.equal(layer.attention,1);assert.ok(layer.cells.find(c=>c.key==='unplaced').people.includes(p.id));assert.equal(reception(map.archives[0]),'unarranged');
 await s.setState({id:p.id,expected_version:1,status:'已入伙',member_status:'请假',member_ids:[],request_id:uuid()});map=await personnelMap(f.env,f.actor,{});assert.equal(reception(map.archives[0]),'unavailable');assert.deepEqual(personnelAttention(map.archives[0]),[]);
 await s.setState({id:p.id,expected_version:2,status:'已入伙',member_status:'失联',member_ids:[],request_id:uuid()});map=await personnelMap(f.env,f.actor,{});assert.deepEqual(personnelAttention(map.archives[0]),['社员失联待联系']);
});

test('profile edits cannot reset stage dwell; friends and members are not forced into later stages',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),p=await s.create({type:'person',name:'长期个人接触',request_id:uuid()});
 await s.setState({id:p.id,expected_version:1,status:'个人接触',member_ids:[],request_id:uuid()});
 const past=new Date(Date.now()-90*86400000).toISOString();f.sqlite.prepare('UPDATE archive_events SET created_at=? WHERE archive_id=?').run(past,p.id);
 const a=await s.get(p.id);await s.update({id:p.id,expected_version:a.version,name:a.name,contacts:[],links:[],current_need:'刚刚更新资料',request_id:uuid()});
 let map=await personnelMap(f.env,f.actor,{});assert.equal(map.archives[0].overdue,false);assert.equal(map.archives[0].stage_since,past);assert.ok(personnelAttention(map.archives[0]).includes('阶段停留待核对'));assert.equal(map.layers.find(l=>l.id==='个人接触').attention,1);
 await s.setState({id:p.id,expected_version:3,status:'外部社友',member_ids:[],request_id:uuid()});f.sqlite.prepare('UPDATE archive_events SET created_at=? WHERE archive_id=?').run(past,p.id);map=await personnelMap(f.env,f.actor,{});assert.ok(!personnelAttention(map.archives[0]).includes('阶段停留待核对'));
});

test('explicit same-stage transfers preserve other affiliations, are idempotent and remain searchable after closure',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),a=await makeResource(f,'原社内资源'),b=await makeResource(f,'新社内资源'),c=await makeResource(f,'保留社内资源'),p=await s.create({type:'person',name:'调动人员',status:'个人接触',resources:[allocation(a),allocation(a),allocation(a,{usage:'planned'}),allocation(c),allocation(b,{usage:'planned'})],request_id:uuid()});
 const input={id:p.id,expected_version:1,from_resource_id:a.id,to_resource_id:b.id,reason:'按实际建设安排调入',request_id:uuid()};const first=await s.transferResource(input);assert.equal(first.version,2);assert.equal((await s.transferResource(input)).replayed,true);
 const after=await s.get(p.id);assert.ok(!after.resources.some(r=>r.internal_resource_id===a.id&&r.usage==='active'));assert.ok(after.resources.some(r=>r.internal_resource_id===b.id&&r.usage==='active'));assert.ok(after.resources.some(r=>r.internal_resource_id===c.id&&r.usage==='active'));assert.equal(after.status,'个人接触');assert.equal(after.resources.find(r=>r.internal_resource_id===b.id&&r.usage==='active').note,input.reason);assert.ok(!after.resources.some(r=>r.internal_resource_id===a.id&&r.usage==='planned'),'redundant old plans cannot revive after a transfer');
 let map=await personnelMap(f.env,f.actor,{}),edge=map.links.find(l=>l.kind==='resource_transfer'),cells=map.layers.flatMap(l=>l.cells);assert.equal(cells.find(c=>c.id===edge.from).resource_id,a.id);assert.equal(cells.find(c=>c.id===edge.to).resource_id,b.id);assert.equal(map.movements[0].reason,input.reason);
 await s.setState({id:p.id,expected_version:2,status:'已弃用',member_ids:[],request_id:uuid()});map=await personnelMap(f.env,f.actor,{query:'原社内资源'});assert.equal(map.archives.length,0);assert.equal(map.history_archives[0].id,p.id);assert.ok(map.history_archives[0].closed);assert.ok(map.links.some(l=>l.kind==='resource_transfer'));assert.equal(map.internal_resources.find(r=>r.id===a.id).used,0);
 f.sqlite.prepare('UPDATE archives SET deleted=1 WHERE id=?').run(p.id);map=await personnelMap(f.env,f.actor,{});assert.equal(map.history_archives.length,0);assert.equal(map.movements.length,0);assert.equal(map.links.length,0);
});

test('independent profile changes record arrivals/departures without inventing transfers; unknown old snapshots remain unknown',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),a=await makeResource(f,'移出资源'),b=await makeResource(f,'移入资源'),p=await s.create({type:'person',name:'独立安排',resources:[allocation(a)],request_id:uuid()});
 await update(s,await s.get(p.id),[allocation(b)]);let map=await personnelMap(f.env,f.actor,{});assert.equal(map.links.filter(l=>l.kind==='resource_transfer').length,0);const change=map.movements.find(m=>m.kind==='archive.profile_changed');assert.equal(change.before_resources[0].internal_resource_id,a.id);assert.equal(change.resources[0].internal_resource_id,b.id);
 // A migrated archive may predate resource snapshots. Do not turn unknown into unplaced.
 const other=await s.create({type:'person',name:'旧记录',request_id:uuid()});const row=f.sqlite.prepare("SELECT id,after_json FROM archive_events WHERE archive_id=? AND kind='archive.created'").get(other.id),payload=JSON.parse(row.after_json);delete payload.resources;f.sqlite.prepare('UPDATE archive_events SET after_json=? WHERE id=?').run(JSON.stringify(payload),row.id);
 await s.setState({id:other.id,expected_version:1,status:'个人接触',member_ids:[],request_id:uuid()});map=await personnelMap(f.env,f.actor,{});assert.equal(map.movements.find(m=>m.archive_id===other.id).resources_known,false);const unknown=map.layers.flatMap(l=>l.cells).filter(c=>c.key==='history-unknown');assert.equal(unknown.length,2);
 const ancient=await s.create({type:'person',name:'阶段未记录的旧档案',request_id:uuid()}),event=f.sqlite.prepare("SELECT id,after_json FROM archive_events WHERE archive_id=? AND kind='archive.created'").get(ancient.id),old=JSON.parse(event.after_json);delete old.status;f.sqlite.prepare('UPDATE archive_events SET after_json=? WHERE id=?').run(JSON.stringify(old),event.id);await update(s,await s.get(ancient.id),[allocation(b)]);map=await personnelMap(f.env,f.actor,{});const unknownStage=map.movements.find(m=>m.archive_id===ancient.id);assert.equal(unknownStage.before,'阶段未记录');assert.equal(unknownStage.after,'阶段未记录');assert.equal(map.archives.find(a=>a.id===ancient.id).stage_since,'');
});

test('transfer history and receipts roll back on write failure, changed source version and retired target races',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),a=await makeResource(f),b=await makeResource(f,'目标'),p=await s.create({type:'person',name:'原人员',resources:[allocation(a)],request_id:uuid()});
 const input={id:p.id,expected_version:1,from_resource_id:a.id,to_resource_id:b.id,reason:'实际调动',request_id:uuid()};
 await assert.rejects(s.transferResource({...input,expected_version:2,request_id:uuid()}),{code:'VERSION_CONFLICT'});
 f.sqlite.exec("CREATE TRIGGER fail_transfer BEFORE INSERT ON archive_events WHEN NEW.kind='archive.resource_transferred' BEGIN SELECT RAISE(ABORT,'test transfer failure'); END;");await assert.rejects(s.transferResource(input));assert.equal((await s.get(p.id)).version,1);assert.equal((await s.get(p.id)).resources[0].internal_resource_id,a.id);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM commands WHERE request_id=?').get(input.request_id).n,0);f.sqlite.exec('DROP TRIGGER fail_transfer');f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.actor.id);await assert.rejects(s.transferResource(input),{code:'PRECONDITION_CHANGED'});f.sqlite.prepare('UPDATE members SET frozen=0 WHERE id=?').run(f.actor.id);
 const onlyPlanned=await s.create({type:'person',name:'仅有计划',resources:[allocation(a,{usage:'planned'})],request_id:uuid()});await assert.rejects(s.transferResource({...input,id:onlyPlanned.id,request_id:uuid()}),{code:'TRANSFER_SOURCE_CHANGED'});
 const batch=f.env.DB.batch.bind(f.env.DB);f.env.DB.batch=async statements=>{f.sqlite.prepare("UPDATE internal_resources SET status='archived' WHERE id=?").run(b.id);return batch(statements);};await assert.rejects(s.transferResource(input),{code:'PRECONDITION_CHANGED'});assert.equal((await s.get(p.id)).version,1);
});

test('planned load excludes active duplicates and exposes projected pressure without hiding actual excess',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),r=await makeResource(f,'资源',{capacity:1}),catalog=new InternalResources(f.env,f.actor,'web');
 await s.create({type:'person',name:'已落实',resources:[allocation(r),allocation(r,{usage:'planned'})],request_id:uuid()});await s.create({type:'person',name:'待落实',resources:[allocation(r,{usage:'planned'}),allocation(r,{usage:'planned'})],request_id:uuid()});
 const resource=await catalog.get(r.id);assert.equal(resource.used,1);assert.equal(resource.planned,1);assert.equal(resource.remaining,0);assert.equal(resource.projected_remaining,0);assert.equal(resource.overplanned,1);
 const map=await personnelMap(f.env,f.actor,{}),planned=map.archives.find(a=>a.name==='待落实');assert.ok(personnelAttention(planned,Date.now(),map.internal_resources).some(r=>r.includes('计划超额')));assert.ok(personnelAttention(planned,Date.now(),map.internal_resources).some(r=>r.includes('承接人待明确')));
});

test('work outcomes use recorded events independently of observation volume and include closed history',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web'),a=await makeResource(f),b=await makeResource(f,'目标资源'),p=await s.create({type:'person',name:'无观察社员',status:'已入伙',request_id:uuid()});
 const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10),q={from:day,to:day};let stats=await statistics(f.env,f.actor,q);assert.equal(stats.total,0);assert.equal(stats.work.current.waiting,1);assert.equal(stats.work.period.created,1);assert.equal(stats.work.period.joined,0,'initial member registration is not a recorded joining transition');
 await update(s,await s.get(p.id),[allocation(a)]);await s.transferResource({id:p.id,expected_version:2,from_resource_id:a.id,to_resource_id:b.id,reason:'实际调入',request_id:uuid()});await s.setState({id:p.id,expected_version:3,status:'已弃用',membership_action:'leave',member_ids:[],request_id:uuid()});
 stats=await statistics(f.env,f.actor,{...q,search:'不匹配观察分组'});assert.equal(stats.total,0);assert.equal(stats.work.current.people,0);assert.equal(stats.work.period.arrivals,1);assert.equal(stats.work.period.departures,1);assert.equal(stats.work.period.resource_transfers,1);assert.equal(stats.work.period.closed,1);assert.equal((await statistics(f.env,f.actor,{...q,archive_type:'org'})).work,undefined);
});

test('shareable view state round-trips dates, comparison choices, map selection and independent tab conditions',()=>{
 const params=new URLSearchParams('view=people'),view={from:'2026-10-01',to:'2026-11-06',group:'tag',interval:'week',archive_type:'person',search:'技能：资料',selected:['tag1','tag2'],cumulative:true};writeStatisticsView(params,view);writePersonnelQuery(params,{query:'社内资源',days:90});const map={stage:'已入伙',selected:'已入伙|internal:abc',selectedLink:null,list:false,scale:.8,work:'planned'};writePersonnelView(params,map);
 assert.deepEqual(readStatisticsView(params),view);assert.deepEqual(readPersonnelQuery(params),{query:'社内资源',days:90});assert.deepEqual(readPersonnelView(params),map);assert.equal(params.get('view'),'people');params.set('s_from','2026-02-30');assert.notEqual(readStatisticsView(params).from,'2026-02-30');params.set('p_days','999');assert.equal(readPersonnelQuery(params).days,30);
});
