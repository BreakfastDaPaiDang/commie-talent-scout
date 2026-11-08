import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {buildExperience,experienceWidths,dayMs} from '../app/shared/work-overview.ts';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {WorkOverview} from '../app/server/work-overview.ts';

const time=n=>new Date(Date.UTC(2026,10,1)+n*dayMs).toISOString();
const archive={id:'p',status:'个人接触'},event=(id,seq,day,status)=>({id,seq,archive_id:'p',created_at:time(day),kind:'archive.state_changed',after:{status}});
const observation=(id,seq,day)=>({id,event_id:'event-'+id,event_seq:seq,archive_id:'p',created_at:time(day),body:id,author_name:'甲'});
test('same-stage records stay separate, ties use event order, and rollback retains its real boundary',()=>{
 const events=[event('start',1,0,'个人接触'),event('review',3,2,'人事审核'),event('return',6,4,'个人接触')];
 const obs=[observation('a',2,2),observation('b',4,2),observation('c',5,2),observation('d',7,5)];
 const segments=buildExperience(archive,events,obs,[],time(6));
 assert.deepEqual(segments.map(s=>s.id),['start','event-a','review','event-b','event-c','return','event-d']);
 assert.deepEqual(segments.filter(s=>s.source==='observation').map(s=>[s.observation_id,s.type,s.observations.length]),[['a','contact',1],['b','review',1],['c','review',1],['d','contact',1]]);
 const widths=experienceWidths(segments,6);assert.ok(widths.every(w=>w>0));assert.ok(Math.abs(widths.reduce((a,b)=>a+b,0)-87.5)<1e-9);
 const ordinary=buildExperience(archive,[event('a',1,0,'个人接触'),event('b',2,2,'人事审核'),event('c',3,6,'个人接触')],[],[],time(11));
 assert.deepEqual(experienceWidths(ordinary,11),[2/11*87.5,4/11*87.5,5/11*87.5]);
 const sameDay=buildExperience(archive,[event('a',1,0,'个人接触')],[observation('new',2,.1)],[],time(.25));assert.ok(Math.abs(experienceWidths(sameDay,.25).reduce((a,b)=>a+b,0)-87.5)<1e-9);
});
test('backfill inserts its own record without stealing placements or inventing an unknown stage',()=>{
 const events=[event('start',1,1,'个人接触'),event('review',2,4,'人事审核')];
 const obs=[{...observation('backfill',3,8),occurred_at:time(2)},{...observation('early',4,8),occurred_at:time(0)}];
 const placement={id:'placement',archive_id:'p',event_id:'start',resource_ids:['r']};
 const segments=buildExperience(archive,events,obs,[placement],time(9));
 assert.equal(segments[0].type,null);assert.equal(segments[2].observation_id,'backfill');assert.equal(segments[2].type,'contact');
 assert.deepEqual(segments.flatMap(s=>s.placements),[placement]);assert.equal(segments[2].placements.length,0);
});
test('real submitted observations keep stable containers across edit, delete and restore; placements remain on their own source',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web'),obs=new Observations(f.env,f.actor,'web'),overview=new WorkOverview(f.env,f.actor);
 const a=await archives.create({type:'person',name:'独立容器验收',request_id:id()});
 const first=await obs.create({archive_id:a.id,body:'首次联系',request_id:id()}),second=await obs.create({archive_id:a.id,body:'再次联系',request_id:id()});
 const read=async()=>((await overview.read({})).people.find(p=>p.id===a.id));
 let p=await read();const own=p.segments.find(s=>s.observation_id===first.id),secondOwn=p.segments.find(s=>s.observation_id===second.id);
 assert.notEqual(own.id,secondOwn.id);assert.equal(p.segments.filter(s=>s.source==='observation').length,2);
 const place={entity:'placement',id:id(),expected_version:0,archive_id:a.id,event_id:own.id,resource_ids:[],note:'仅属于首次联系',usage:'active',request_id:id()};await overview.save(place);
 const due=p.due_at;await obs.update({id:first.id,expected_version:1,body:'修订首次联系',occurred_at:null,request_id:id()});
 p=await read();assert.equal(p.due_at,due);assert.equal(p.segments.filter(s=>s.source==='observation').length,2);assert.equal(p.segments.find(s=>s.observation_id===first.id).id,own.id);assert.equal(p.segments.find(s=>s.observation_id===second.id).placements.length,0);
 const editEvent=f.sqlite.prepare("SELECT id FROM archive_events WHERE observation_id=? AND kind='observation.edited'").get(first.id);
 await assert.rejects(overview.save({...place,id:id(),event_id:editEvent.id,request_id:id()}),{code:'INVALID_EXPERIENCE'});
 await obs.setDeleted({id:first.id,expected_version:2,request_id:id()},true);p=await read();assert.ok(!p.segments.some(s=>s.observation_id===first.id));
 await assert.rejects(overview.save({...place,expected_version:1,request_id:id()}),{code:'INVALID_EXPERIENCE'});
 await obs.setDeleted({id:first.id,expected_version:3,request_id:id()},false);p=await read();assert.equal(p.segments.find(s=>s.observation_id===first.id).placements[0].note,place.note);
});
