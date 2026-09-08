import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('observation-boundaries'),checks=[];
try{
 const archive=await v.call('create_archive',{type:'person',name:'虚构观察关闭并发验收',request_id:randomUUID()});
 const race=await Promise.all([v.http('/observations/create',{archive_id:archive.id,body:'这条虚构观察与关闭并发',occurred_at:null,request_id:randomUUID()}),v.http('/archives/state',{id:archive.id,expected_version:1,status:'已弃用',member_ids:[],request_id:randomUUID()})]);assert.equal(race.filter(r=>r.status===200).length,1);assert.equal(race.filter(r=>r.status===409).length,1);
 const current=(await v.call('get_archive',{id:archive.id})).archive;assert.equal(current.observation_count,race[0].status===200?1:0);assert.equal(current.closed,race[1].status===200);
 checks.push('concurrent publication and close allow only one commit and never leave a publication after closing');
 const draftArchive=await v.call('create_archive',{type:'org',name:'虚构草稿到期验收',request_id:randomUUID()});
 const input={archive_id:draftArchive.id,expected_version:0,body:'过期的虚构草稿',occurred_at:null,request_id:randomUUID()};assert.equal((await v.http('/drafts/save',input)).status,200);
 const file=`tmp/verification/draft-expiry-${v.target}.sql`;writeFileSync(file,`UPDATE observation_drafts SET updated_at='2020-01-01T00:00:00.000Z' WHERE archive_id='${draftArchive.id}' AND member_id='${v.actor.id}';`);
 const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cts-staging','--env','staging',v.target==='cloud'?'--remote':'--local','--file',file,'--json'],{encoding:'utf8'});assert.equal(result.status,0,'expire only this synthetic draft');
 assert.equal((await v.http('/drafts/'+draftArchive.id)).body.draft,null);assert.equal((await v.http('/drafts')).body.drafts.some(d=>d.archive_id===draftArchive.id),false);
 assert.equal((await v.http('/drafts/save',{...input,body:'到期后新写的草稿',request_id:randomUUID()})).status,200);
 checks.push('expired drafts are hidden at read time and can be safely replaced without a stale-version trap');
 const source=(await v.call('list_archives',{type:'person',query:'虚构文字观察验收'})).archives.find(a=>a.observation_count===2);assert.ok(source);
 const observed=(await v.call('list_observations',{archive_id:source.id})).observations.find(o=>o.author_id!==v.actor.id);assert.ok(observed);
 const author=(await v.call('get_member',{id:observed.author_id})).member;assert.equal(author.frozen,true);assert.equal(observed.author_name,author.name);
 checks.push('freezing a previous author keeps their stable identity and name on published observations');
}finally{await v.close(checks);}
