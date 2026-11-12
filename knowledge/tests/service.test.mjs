import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,draft,proposal,adopt,request} from './fixture.mjs';
import {Knowledge,expire} from '../src/service.ts';

test('private drafts, search and immutable submitted versions; three distinct current members adopt',async t=>{
 const f=fixture();t.after(f.close);const [a,b,c]=f.services;const d=await draft(a);
 assert.equal((await a.list({scope:'drafts'})).entries[0].state,'draft');assert.equal((await b.list({scope:'drafts'})).entries.length,0);await assert.rejects(b.get({id:d.entry_id}),{code:'NOT_FOUND'});assert.equal((await a.effective({})).entries.length,0);
 const p=await a.submit({id:d.id,expected_revision:1,request_id:request()});assert.equal((await b.list({scope:'pending'})).entries.length,1);
 await assert.rejects(a.save({id:d.id,expected_revision:1,title:'改写',body:'不允许',tags:[],request_id:request()}),{code:'DRAFT_OWNER_REQUIRED'});
 assert.throws(()=>f.sqlite.prepare('UPDATE kb_versions SET body=? WHERE id=?').run('偷改',d.id),/immutable/);
 const first={proposal_id:p.proposal_id,request_id:request()};await a.endorse(first);await a.endorse(first);await a.endorse({proposal_id:p.proposal_id,request_id:request()});await b.endorse({proposal_id:p.proposal_id,request_id:request()});assert.equal((await a.effective({})).entries.length,0);
 const result=await c.endorse({proposal_id:p.proposal_id,request_id:request()});assert.equal(result.status,'accepted');assert.equal(result.votes,3);
 assert.equal((await a.effective({})).entries[0].body,'为了检验一个明确判断，应当先收集实际材料。');assert.equal((await b.list({search:'判断',tag:'共识'})).entries.length,1);assert.equal((await b.list({search:'不存在'})).entries.length,0);
});
test('revision votes start at zero, old content remains effective and failed revisions do not discard it',async t=>{
 const f=fixture();t.after(f.close);const [a,b]=f.services,p=await proposal(a);await adopt(f,p);
 const d=await draft(b,{entry_id:p.entry_id,title:'新判断',body:'修订内容'});assert.equal((await a.get({id:p.entry_id})).versions.length,1);
 const rev=await b.submit({id:d.id,expected_revision:1,request_id:request()});assert.equal((await a.effective({})).entries[0].title,'测试知识');assert.equal((await a.list({scope:'pending',search:'新判断'})).entries[0].display_version_id,d.id);
 await a.endorse({proposal_id:rev.proposal_id,request_id:request()});f.advance(7*86400000);await assert.rejects(b.endorse({proposal_id:rev.proposal_id,request_id:request()}),{code:'PROPOSAL_ENDED'});
 assert.equal((await a.get({id:p.entry_id})).proposals.find(x=>x.id===rev.proposal_id).status,'expired');await expire(f.db,f.clock());await expire(f.db,f.clock());assert.equal(f.sqlite.prepare("SELECT count(*) n FROM kb_events WHERE kind='proposal.expired'").get().n,1);
 assert.equal((await a.effective({})).entries[0].id,p.version_id);assert.equal((await a.list({scope:'discarded'})).entries.length,0);
});
test('resubmission retains original votes as history and restarts seven days on the new version',async t=>{
 const f=fixture();t.after(f.close);const a=f.services[0],p=await proposal(a);await a.endorse({proposal_id:p.proposal_id,request_id:request()});f.advance(86400000);
 const d=await draft(a,{entry_id:p.entry_id,body:'重新整理'}),next=await a.submit({id:d.id,expected_revision:1,replace_proposal_id:p.proposal_id,request_id:request()});
 assert.equal(next.votes,0);assert.equal(Date.parse(next.deadline_at)-Date.parse(p.deadline_at),86400000);
 const history=await a.get({id:p.entry_id});assert.equal(history.proposals.find(x=>x.id===p.proposal_id).status,'superseded');assert.equal(history.votes.length,1);assert.equal((await a.effective({})).entries.length,0);
});
test('close needs three votes even from admin; stale competing revisions and close proposals cannot affect new content',async t=>{
 const f=fixture();t.after(f.close);const a=f.services[0],b=f.services[1],p=await proposal(a);await adopt(f,p);
 const closing=await a.proposeClose({entry_id:p.entry_id,reason:'需要重新讨论',request_id:request()});assert.equal((await a.effective({})).entries.length,1);
 const one=await proposal(a,{entry_id:p.entry_id,body:'第一修订'}),two=await proposal(b,{entry_id:p.entry_id,body:'第二修订'});await adopt(f,one);
 await assert.rejects(b.endorse({proposal_id:two.proposal_id,request_id:request()}),{code:'PROPOSAL_ENDED'});await assert.rejects(b.endorse({proposal_id:closing.proposal_id,request_id:request()}),{code:'PROPOSAL_ENDED'});
 assert.equal((await a.effective({})).entries[0].body,'第一修订');const final=await a.proposeClose({entry_id:p.entry_id,reason:'明确关闭',request_id:request()});await adopt(f,final);assert.equal((await a.effective({})).entries.length,0);assert.equal((await a.list({scope:'discarded'})).entries.length,1);assert.ok((await a.get({id:p.entry_id})).entry.closed_at);
});
test('unadopted content expires exactly at deadline and knowledge reads stay read-only',async t=>{
 const f=fixture();t.after(f.close);const a=f.services[0],p=await proposal(a);f.advance(7*86400000-1);await a.endorse({proposal_id:p.proposal_id,request_id:request()});f.advance(1);
 await assert.rejects(f.services[1].endorse({proposal_id:p.proposal_id,request_id:request()}),{code:'PROPOSAL_ENDED'});
 const before=f.sqlite.prepare('SELECT total_changes() n').get().n;assert.equal((await a.list({scope:'pending'})).entries.length,0);assert.equal((await a.list({scope:'discarded'})).entries.length,1);await a.get({id:p.entry_id});await a.effective({});await a.changes();assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
});
test('formal membership required for voting and public revisions, without admin bypass or main database tables',async t=>{
 const f=fixture();t.after(f.close);const a=f.services[0],p=await proposal(a),outsider=new Knowledge(f.db,{...f.actors[3],eligible:false,membership_id:null,role:'admin'},f.clock);
 await assert.rejects(outsider.endorse({proposal_id:p.proposal_id,request_id:request()}),{code:'MEMBERSHIP_REQUIRED'});await assert.rejects(draft(outsider,{entry_id:p.entry_id}),{code:'MEMBERSHIP_REQUIRED'});assert.ok((await outsider.get({id:p.entry_id})).entry.public_at);
 const tables=f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);assert.ok(!tables.includes('archives'));assert.ok(!tables.includes('members'));assert.ok(!tables.includes('work_tasks'));assert.ok(!tables.includes('credentials'));
});
test('transaction rollback, same-request recovery, changed-request rejection and concurrent third votes',async t=>{
 const f=fixture();t.after(f.close);const a=f.services[0],p=await proposal(a);await a.endorse({proposal_id:p.proposal_id,request_id:request()});await f.services[1].endorse({proposal_id:p.proposal_id,request_id:request()});
 const batch=f.db.batch;f.db.batch=statements=>batch([...statements,f.db.prepare('INSERT INTO missing_table VALUES(1)')]);const vote={proposal_id:p.proposal_id,request_id:request()};await assert.rejects(f.services[2].endorse(vote));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM kb_votes').get().n,2);assert.equal((await a.effective({})).entries.length,0);assert.equal(await f.services[2].receipt(vote.request_id),null);f.db.batch=batch;
 const outcomes=await Promise.allSettled([f.services[2].endorse(vote),f.services[3].endorse({proposal_id:p.proposal_id,request_id:request()})]);assert.ok(outcomes.some(r=>r.status==='fulfilled'));assert.equal((await a.changes()).revision,1);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM kb_events WHERE kind='proposal.accepted'").get().n,1);
 const saved=await f.services[2].receipt(vote.request_id);if(saved)assert.deepEqual(await f.services[2].endorse(vote),saved);
 const input={title:'原稿',body:'正文',tags:[],request_id:request()};const d=await a.save(input);assert.deepEqual(await a.save(input),d);await assert.rejects(a.save({...input,title:'换稿'}),{code:'REQUEST_REUSED'});
});
test('effective full-text pagination detects intervening acceptance and requires the snapshot revision',async t=>{
 const f=fixture();t.after(f.close);const a=f.services[0];for(let i=0;i<3;i++)await adopt(f,await proposal(a,{title:'条目'+i,body:'完整正文'.repeat(2000)}));
 const first=await a.effective({limit:1});assert.equal(first.complete,false);assert.equal(first.entries[0].body.length,8000);
 await assert.rejects(a.effective({cursor:first.next_cursor,limit:1}),{code:'REVISION_REQUIRED'});const next=await a.effective({cursor:first.next_cursor,revision:first.revision,limit:1});assert.notEqual(next.entries[0].id,first.entries[0].id);
 await adopt(f,await proposal(a));await assert.rejects(a.effective({cursor:next.next_cursor,revision:first.revision,limit:1}),{code:'KNOWLEDGE_CHANGED'});
});

test('an expiry committed between vote preparation and commit prevents a late third vote',async t=>{
 const f=fixture();t.after(f.close);const a=f.services[0],p=await proposal(a);await a.endorse({proposal_id:p.proposal_id,request_id:request()});await f.services[1].endorse({proposal_id:p.proposal_id,request_id:request()});
 const batch=f.db.batch;let once=false;f.db.batch=async statements=>{if(!once){once=true;f.db.batch=batch;f.advance(7*86400000);await expire(f.db,f.clock());}return batch(statements);};
 await assert.rejects(f.services[2].endorse({proposal_id:p.proposal_id,request_id:request()}),{code:'CONFLICT'});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM kb_votes').get().n,2);assert.equal((await a.effective({})).entries.length,0);
});
