import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {Reading} from '../app/server/reading.ts';
import {Tags} from '../app/server/tags.ts';

function member(f,name){const id=uuid(),credential=uuid();f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,'2026-01-01T00:00:00.000Z')").run(id,name,name);f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'mcp','fixture',1,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')").run(credential,id,uuid());return {...f.sqlite.prepare('SELECT * FROM members WHERE id=?').get(id),credential_id:credential,credential_kind:'mcp'};}
const create=(s,type,name)=>s.create({type,name,request_id:uuid()});
const observe=(s,id,body)=>s.create({archive_id:id,body,request_id:uuid()});

test('reading is personal, receipt-bound, idempotent and version-aware without touching archive activity',async t=>{
 const f=fixture();t.after(f.close);const writer=member(f,'writer'),other=member(f,'other'),archives=new Archives(f.env,writer,'web'),obs=new Observations(f.env,writer,'web'),reader=new Reading(f.env,f.actor),readerObs=new Observations(f.env,f.actor,'mcp');
 const a=await create(archives,'person','虚构阅读'),o=await observe(obs,a.id,'第一版正文'),before=await archives.get(a.id);assert.equal((await reader.summary()).total,2);assert.equal((await new Reading(f.env,writer).summary()).total,0);
 const summary=await new Archives(f.env,f.actor,'web').list({type:'person'});assert.equal(summary.archives[0].unread_count,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM reading_deliveries').get().n,0);
 const body=(await readerObs.detail(o.id)).observation;assert.ok(body.reading);assert.equal((await reader.summary()).total,2,'returning a body has not yet acknowledged delivery');
 assert.equal((await new Reading(f.env,other).confirm({tickets:[body.reading.ticket]})).confirmed.length,0);
 assert.equal((await reader.confirm({tickets:[uuid()]})).confirmed.length,0);
 const sameMemberOtherConnection=member(f,'unrelated').credential_id;
 assert.equal((await new Reading(f.env,{...f.actor,credential_id:sameMemberOtherConnection}).confirm({tickets:[body.reading.ticket]})).confirmed.length,0);
 assert.equal((await reader.confirm({tickets:[body.reading.ticket,body.reading.ticket]})).confirmed.length,1);assert.equal((await reader.confirm({tickets:[body.reading.ticket]})).confirmed.length,1);assert.equal((await reader.summary()).total,1);assert.equal((await new Reading(f.env,other).summary()).total,2);assert.deepEqual(await archives.get(a.id),before);
 await obs.update({id:o.id,expected_version:1,body:'第二版正文',occurred_at:null,request_id:uuid()});const second=(await readerObs.detail(o.id)).observation;
 await obs.update({id:o.id,expected_version:2,body:'第三版正文',occurred_at:null,request_id:uuid()});assert.equal((await reader.confirm({tickets:[second.reading.ticket]})).confirmed.length,0);assert.equal((await reader.summary()).total,3);
 const third=(await readerObs.detail(o.id)).observation;await reader.confirm({tickets:[third.reading.ticket]});assert.equal((await reader.summary()).total,2,'old unseen events remain independent');
 f.sqlite.prepare("UPDATE archive_events SET created_at='2020-01-01T00:00:00.000Z' WHERE kind='archive.created'").run();assert.equal((await reader.summary()).total,1,'pre-account updates do not count');
});

test('search returns the current version of an older observation, escaping LIKE, combining filters and excluding deleted body',async t=>{
 const f=fixture();t.after(f.close);const writer=member(f,'writer'),service=new Archives(f.env,writer,'web'),obs=new Observations(f.env,writer,'web'),reader=new Archives(f.env,f.actor,'web');
 const a=await create(service,'person','虚构搜索'),old=await observe(obs,a.id,'前文'.repeat(300)+'罕见命中_100%\\尾部'),newer=await observe(obs,a.id,'最新普通观察');
 let r=await reader.list({type:'person',query:'命中_100%\\'});assert.equal(r.archives.length,1);assert.equal(r.archives[0].search_match.observation_id,old.id);assert.match(r.archives[0].search_match.excerpt,/命中_100%\\/);assert.equal(r.archives[0].latest_observation,'最新普通观察');
 assert.equal((await reader.list({type:'person',scope:'mine'})).archives.length,0);let current=await service.get(a.id);
 await service.setState({id:a.id,expected_version:current.version,status:'人事审核',member_ids:[f.actor.id],request_id:uuid()});assert.equal((await reader.list({type:'person',scope:'mine',member_id:f.actor.id,status:'人事审核',closed:'open',query:'罕见命中'})).archives.length,1);
 current=await service.get(a.id);await service.setState({id:a.id,expected_version:current.version,status:'个人接触',member_ids:[],request_id:uuid()});assert.equal((await reader.list({type:'person',scope:'mine'})).archives.length,0,'prior work-state owner is not a current owner');
 await obs.update({id:old.id,expected_version:1,body:'替换后新事实',occurred_at:null,request_id:uuid()});assert.equal((await reader.list({type:'person',query:'罕见命中'})).archives.length,0,'historical superseded body is not ordinary current-body search');
 await obs.setDeleted({id:old.id,expected_version:2,request_id:uuid()},true);assert.equal((await reader.list({type:'person',query:'替换后新事实'})).archives.length,0);assert.equal((await reader.list({type:'person'})).archives[0].observation_count,1);assert.equal((await reader.list({type:'org'})).archives.length,0);assert.ok(newer.id);
});

test('hidden-only tag evidence is filtered before unread counts and page boundaries; deletion context and closed event remain readable',async t=>{
 const f=fixture();t.after(f.close);const writer=member(f,'writer'),archives=new Archives(f.env,writer,'web'),obs=new Observations(f.env,writer,'web'),reader=new Reading(f.env,f.actor),readerObs=new Observations(f.env,f.actor,'web'),a=await create(archives,'person','虚构隐藏标签'),o=await observe(obs,a.id,'仅作者可见的原始依据');
 const tags=new Tags(f.env,writer,'web'),tag=f.sqlite.prepare("SELECT id FROM tags WHERE name='视频剪辑'").get();await tags.batch({archive_id:a.id,expected_version:2,changes:[{tag_id:tag.id,action:'add',evidence:[{kind:'observation',note:'隐藏依据说明',observation_id:o.id,content_version:1}]}],request_id:uuid()});
 const delivered=(await readerObs.detail(o.id)).observation;await obs.setDeleted({id:o.id,expected_version:1,request_id:uuid()},true);assert.equal((await reader.confirm({tickets:[delivered.reading.ticket]})).confirmed.length,0);
 const expected=3;assert.equal((await reader.summary()).total,expected);let cursor,seen=[];do{const r=await reader.list({limit:1,...(cursor?{before:Number(cursor)}:{})});assert.equal(r.events.length,1);seen.push(...r.events);cursor=r.next_cursor;}while(cursor);assert.equal(seen.length,expected);assert.ok(!seen.some(e=>e.kind==='archive.tags_changed'));
 const timeline=await readerObs.timeline({id:a.id,limit:2});assert.equal(timeline.events.length,2);assert.ok(!JSON.stringify(timeline).includes('隐藏依据说明'));const deletion=timeline.events.find(e=>e.kind==='observation.deleted');assert.equal(deletion.observation,null);assert.ok(deletion.reading);await reader.confirm({tickets:[deletion.reading.ticket]});
 const current=await archives.get(a.id);await archives.setState({id:a.id,expected_version:current.version,status:'已弃用',member_ids:[],request_id:uuid()});const eventId=f.sqlite.prepare("SELECT id FROM archive_events WHERE kind='archive.closed'").get().id;const closed=(await readerObs.event(eventId)).event;assert.equal(closed.kind,'archive.closed');assert.ok(closed.reading);assert.equal((await reader.confirm({tickets:[closed.reading.ticket]})).confirmed.length,1);
});

test('representative data uses two bounded archive queries and stable cursors across equal activity times and a snapshot of unread updates',async t=>{
 const f=fixture();t.after(f.close);const writer=member(f,'writer'),at='2027-01-01T00:00:00.000Z',ids=[];
 const ar=f.sqlite.prepare("INSERT INTO archives(id,type,name,created_by,created_at,updated_at) VALUES(?,'person',?,?,?,?)"),ob=f.sqlite.prepare('INSERT INTO observations(id,archive_id,author_id,created_at,updated_at) VALUES(?,?,?,?,?)'),ver=f.sqlite.prepare('INSERT INTO observation_versions(observation_id,version,body,editor_id,created_at) VALUES(?,1,?,?,?)'),ev=f.sqlite.prepare("INSERT INTO archive_events(id,archive_id,actor_id,source,kind,after_json,observation_id,created_at) VALUES(?,?,?,'web','observation.created',?,?,?)");
 f.sqlite.exec('BEGIN');for(let n=0;n<150;n++){const id=uuid();ids.push(id);ar.run(id,'虚构性能 '+n,writer.id,at,at);for(let k=0;k<8;k++){const oid=uuid();ob.run(oid,id,writer.id,at,at);ver.run(oid,'长观察内容'.repeat(1000)+(k===2?'唯一检索片段':''),writer.id,at);ev.run(uuid(),id,writer.id,JSON.stringify({id:oid,content_version:1}),oid,at);}}f.sqlite.exec('COMMIT');
 let queryCount=0;const prepare=f.env.DB.prepare;f.env.DB.prepare=sql=>{queryCount++;return prepare(sql);};const service=new Archives(f.env,f.actor,'web'),start=performance.now();let cursor,all=[];
 do{const before=queryCount,r=await service.list({type:'person',query:'唯一检索片段',limit:30,...(cursor?{before:cursor}:{})});assert.equal(queryCount-before,2,'one list projection and one batched tag summary');assert.equal(r.archives.length,30);assert.ok(r.archives.every(a=>a.search_match&&a.unread_count===8));all.push(...r.archives.map(a=>a.id));cursor=r.next_cursor;}while(cursor);
 assert.equal(all.length,150);assert.equal(new Set(all).size,150);assert.deepEqual([...all].sort(),ids.sort());t.diagnostic(`150 archives / 1,200 observations / 6M body characters / 5 pages: ${Math.round(performance.now()-start)} ms, ${queryCount} DB reads`);
 const reading=new Reading(f.env,f.actor),first=await reading.list({limit:100});const extra=uuid();ev.run(extra,ids[0],writer.id,'{}',null,at);let snapshotSeen=[...first.events],next=first.next_cursor;while(next){const r=await reading.list({snapshot:first.snapshot,before:Number(next),limit:100});snapshotSeen.push(...r.events);next=r.next_cursor;}assert.equal(snapshotSeen.length,1200);assert.ok(!snapshotSeen.some(e=>e.id===extra));assert.ok((await reading.list({limit:1})).events.some(e=>e.id===extra));
});
