import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {personStates,memberStatuses} from '../app/shared/archive-states.ts';

test('person ranges partition joined and external archives before counts, filters and pagination',async t=>{
 const f=fixture();t.after(f.close);const service=new Archives(f.env,f.actor,'web'),rows=[];
 for(const status of personStates)rows.push({...(await service.create({type:'person',name:'虚构范围 '+status,status,member_ids:[f.actor.id],request_id:uuid()})),status});
 const other=uuid();f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,'2026-01-01')").run(other,other,'虚构观察作者');
 // Make each creation visible as unread for the reader, without changing archive activity.
 f.sqlite.prepare('UPDATE archive_events SET actor_id=?').run(other);
 const all=await service.list({type:'person'});assert.equal(all.counts.all,rows.length);
 for(const person_scope of ['external','members']){
  const expected=rows.filter(row=>memberStatuses.includes(row.status)===(person_scope==='members')).map(row=>row.id).sort();
  let before,seen=[];
  do{
   const r=await service.list({type:'person',person_scope,query:'虚构范围',member_id:f.actor.id,scope:'mine',limit:1,...(before?{before}:{})});
   if(!before)assert.deepEqual(r.counts,{all:expected.length,mine:expected.length,unread:expected.length});else assert.equal(r.counts,undefined);
   seen.push(...r.archives.map(row=>row.id));before=r.next_cursor;
  }while(before);
  assert.deepEqual(seen.sort(),expected);
  assert.deepEqual((await service.list({type:'person',person_scope,scope:'unread'})).archives.map(row=>row.id).sort(),expected);
 }
 assert.equal((await service.list({type:'person',person_scope:'external',status:'已入伙'})).counts.all,0);
 assert.equal((await service.list({type:'person',person_scope:'members',closed:'open'})).counts.all,2);
 assert.equal((await service.list({type:'person',person_scope:'external',closed:'closed'})).counts.all,1);
 const joined=rows.find(row=>row.status==='已入伙');await new Observations(f.env,f.actor,'mcp').create({archive_id:joined.id,body:'虚构观察中的独特检索词',request_id:uuid()});
 assert.equal((await service.list({type:'person',person_scope:'external',query:'独特检索词'})).counts.all,0);
 assert.equal((await service.list({type:'person',person_scope:'members',query:'独特检索词'})).counts.all,1);
 assert.equal((await service.get(joined.id)).id,joined.id,'old direct links can still read the original archive');
 await assert.rejects(service.list({type:'org',person_scope:'members'}),{code:'PERSON_SCOPE_REQUIRED'});
});
