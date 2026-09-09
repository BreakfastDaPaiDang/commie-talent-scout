import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {Reading} from '../app/server/reading.ts';
import {ArchiveReading} from '../app/server/archive-reading.ts';
import {Tags} from '../app/server/tags.ts';

function member(f,name){
 const id=uuid(),credential=uuid();
 f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,'2026-01-01T00:00:00.000Z')").run(id,name,name);
 f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'mcp','fixture',1,'2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z')").run(credential,id,uuid());
 return {...f.sqlite.prepare('SELECT * FROM members WHERE id=?').get(id),credential_id:credential,credential_kind:'mcp'};
}
const create=s=>s.create({type:'person',name:'虚构档案阅读',request_id:uuid()});
const observe=(s,id,body='虚构观察')=>s.create({archive_id:id,body,request_id:uuid()});

test('archive opening confirms only its original personal snapshot; metadata and retries do not read later events or change activity',async t=>{
 const f=fixture();t.after(f.close);const writer=member(f,'writer'),other=member(f,'other'),archives=new Archives(f.env,writer,'web'),observations=new Observations(f.env,writer,'web'),reading=new Reading(f.env,f.actor),opening=new ArchiveReading(f.env,f.actor);
 const a=await create(archives);await observe(observations,a.id);await observe(observations,a.id);
 await new Archives(f.env,f.actor,'mcp').detail(a.id);await new Archives(f.env,f.actor,'web').list({type:'person'});
 assert.equal((await reading.summary()).total,3);
 const ticket=await opening.deliver(a.id);assert.equal((await reading.summary()).total,3,'delivery is not confirmation');
 await observe(observations,a.id,'打开后到达');const before=await archives.get(a.id);
 assert.deepEqual(await opening.confirm({ticket:ticket.ticket}),{member_id:f.actor.id,archive_id:a.id,through_seq:ticket.through_seq,confirmed:true,unread_event_ids:[]});
 assert.equal((await reading.summary()).total,1);assert.equal((await new Reading(f.env,other).summary()).total,4);
 await opening.confirm({ticket:ticket.ticket});assert.equal((await reading.summary()).total,1);assert.deepEqual(await archives.get(a.id),before);
 const list=await new Archives(f.env,f.actor,'web').list({type:'person',scope:'unread'});assert.equal(list.archives[0].unread_count,1);assert.equal(list.counts.unread,1);
 const next=await opening.deliver(a.id);await opening.confirm({ticket:next.ticket});assert.equal((await reading.summary()).total,0);
});

test('revoking the current credential at the confirmation transaction boundary rejects the entire archive read',async t=>{
 const f=fixture();t.after(f.close);const writer=member(f,'writer'),archives=new Archives(f.env,writer,'web'),opening=new ArchiveReading(f.env,f.actor),reading=new Reading(f.env,f.actor),a=await create(archives),ticket=await opening.deliver(a.id);
 f.sqlite.prepare('UPDATE credentials SET revoked_at=? WHERE id=?').run(new Date().toISOString(),f.actor.credential_id);
 await assert.rejects(()=>opening.confirm({ticket:ticket.ticket}),e=>e.code==='READING_EXPIRED');
 assert.equal((await reading.summary()).total,1);
});

test('an opening cannot acknowledge evidence events that were hidden when its snapshot was issued',async t=>{
 const f=fixture();t.after(f.close);const writer=member(f,'writer'),archives=new Archives(f.env,writer,'web'),observations=new Observations(f.env,writer,'web'),opening=new ArchiveReading(f.env,f.actor),reading=new Reading(f.env,f.actor);
 const a=await create(archives),o=await observe(observations,a.id),tag=f.sqlite.prepare("SELECT id FROM tags WHERE name='视频剪辑'").get();
 await new Tags(f.env,writer,'web').batch({archive_id:a.id,expected_version:2,changes:[{tag_id:tag.id,action:'add',evidence:[{kind:'observation',note:'虚构来源',observation_id:o.id,content_version:1}]}],request_id:uuid()});
 await observations.setDeleted({id:o.id,expected_version:1,request_id:uuid()},true);
 const snapshot=await opening.deliver(a.id);assert.equal((await reading.summary()).total,3);
 await observations.setDeleted({id:o.id,expected_version:2,request_id:uuid()},false);
 const result=await opening.confirm({ticket:snapshot.ticket});assert.equal(result.unread_event_ids.length,1);
 assert.deepEqual((await reading.list({})).events.map(e=>e.kind).sort(),['archive.tags_changed','observation.restored']);
});

test('next unread skips the whole current archive across page boundaries and keeps the original queue snapshot',async t=>{
 const f=fixture();t.after(f.close);const writer=member(f,'writer'),archives=new Archives(f.env,writer,'web'),observations=new Observations(f.env,writer,'web'),reading=new Reading(f.env,f.actor);
 const other=await archives.create({type:'org',name:'虚构下一张组织',request_id:uuid()}),current=await create(archives);
 for(let i=0;i<35;i++)await observe(observations,current.id);
 const initial=await reading.list({});assert.ok(initial.next_cursor);assert.ok(initial.events.every(e=>e.archive_id===current.id));
 await observe(observations,other.id,'本次队列之后');
 const next=await reading.list({snapshot:initial.snapshot,exclude_archive_id:current.id,limit:1});
 assert.equal(next.events[0].archive_id,other.id);assert.equal(next.events[0].kind,'archive.created');
});

test('a lost confirmation response can be retried without newly reading evidence restored after the first confirmation',async t=>{
 const f=fixture();t.after(f.close);const writer=member(f,'writer'),archives=new Archives(f.env,writer,'web'),observations=new Observations(f.env,writer,'web'),opening=new ArchiveReading(f.env,f.actor),reading=new Reading(f.env,f.actor);
 const a=await create(archives),o=await observe(observations,a.id),tag=f.sqlite.prepare("SELECT id FROM tags WHERE name='视频剪辑'").get();
 await new Tags(f.env,writer,'web').batch({archive_id:a.id,expected_version:2,changes:[{tag_id:tag.id,action:'add',evidence:[{kind:'observation',note:'虚构来源',observation_id:o.id,content_version:1}]}],request_id:uuid()});
 const snapshot=await opening.deliver(a.id);
 await observations.setDeleted({id:o.id,expected_version:1,request_id:uuid()},true);
 await opening.confirm({ticket:snapshot.ticket});
 await observations.setDeleted({id:o.id,expected_version:2,request_id:uuid()},false);
 const before=await reading.list({});assert.ok(before.events.some(e=>e.kind==='archive.tags_changed'));
 await opening.confirm({ticket:snapshot.ticket});assert.deepEqual(await reading.list({}),before);
});

test('archive tickets are bound to member and connection, expire, and cannot survive archive deletion and restoration',async t=>{
 const f=fixture();t.after(f.close);const writer=member(f,'writer'),other=member(f,'other');f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(writer.id);writer.role='admin';
 const archives=new Archives(f.env,writer,'web'),opening=new ArchiveReading(f.env,f.actor),reading=new Reading(f.env,f.actor),a=await create(archives),snapshot=await opening.deliver(a.id);
 await assert.rejects(new ArchiveReading(f.env,other).confirm({ticket:snapshot.ticket}),{code:'READING_EXPIRED'});
 await assert.rejects(new ArchiveReading(f.env,{...f.actor,credential_id:other.credential_id}).confirm({ticket:snapshot.ticket}),{code:'READING_EXPIRED'});
 await assert.rejects(opening.confirm({ticket:uuid()}),{code:'READING_EXPIRED'});assert.equal((await reading.summary()).total,1);
 const expired=await opening.deliver(a.id);f.sqlite.prepare("UPDATE archive_reading_deliveries SET expires_at='2000-01-01' WHERE id=?").run(expired.ticket);
 await assert.rejects(opening.confirm({ticket:expired.ticket}),{code:'READING_EXPIRED'});
 const closed=await archives.setState({id:a.id,expected_version:1,status:'已弃用',member_ids:[],request_id:uuid()});
 const closingSnapshot=await opening.deliver(a.id);await opening.confirm({ticket:closingSnapshot.ticket});assert.equal((await reading.summary()).total,0,'closed archives can be read');
 const deleted=await archives.setDeleted({id:a.id,expected_version:closed.version,request_id:uuid()},true);
 assert.equal(await opening.deliver(a.id),null);assert.equal(await new ArchiveReading(f.env,writer).deliver(a.id),null,'admin trash reading does not issue a normal unread ticket');
 await assert.rejects(opening.confirm({ticket:snapshot.ticket}),{code:'READING_EXPIRED'});
 await archives.setDeleted({id:a.id,expected_version:deleted.version,request_id:uuid()},false);
 await assert.rejects(opening.confirm({ticket:closingSnapshot.ticket}),{code:'READING_EXPIRED'});
 const fresh=await opening.deliver(a.id);await opening.confirm({ticket:fresh.ticket});assert.equal((await reading.summary()).total,0);
});

test('freezing, downgrading or deleting between receipt lookup and the atomic confirmation cannot mark events',async t=>{
 for(const change of ['freeze','downgrade','trash'])await t.test(change,async t=>{
  const f=fixture();t.after(f.close);f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';
  const writer=member(f,'writer'),a=await create(new Archives(f.env,writer,'web')),opening=new ArchiveReading(f.env,f.actor),ticket=await opening.deliver(a.id),batch=f.env.DB.batch;
  f.env.DB.batch=async statements=>{
   f.env.DB.batch=batch;
   if(change==='freeze')f.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.actor.id);
   if(change==='downgrade')f.sqlite.prepare("UPDATE members SET role='member' WHERE id=?").run(f.actor.id);
   if(change==='trash')f.sqlite.prepare('UPDATE archives SET deleted=1 WHERE id=?').run(a.id);
   return batch(statements);
  };
  await assert.rejects(opening.confirm({ticket:ticket.ticket}),{code:'READING_EXPIRED'});
  f.sqlite.prepare('UPDATE archives SET deleted=0 WHERE id=?').run(a.id);
  assert.equal((await new Reading(f.env,f.actor).summary()).total,1);
 });
});
