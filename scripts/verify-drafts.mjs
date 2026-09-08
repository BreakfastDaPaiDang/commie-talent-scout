import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('drafts'),checks=[];let member;
try{
 const archive=await v.call('create_archive',{type:'person',name:'虚构草稿验收 '+randomUUID().slice(0,8),request_id:randomUUID()});
 const input={archive_id:archive.id,expected_version:0,body:'刷新后仍应存在的草稿',occurred_at:null,request_id:randomUUID()};
 const race=await Promise.all([v.http('/drafts/save',input),v.http('/drafts/save',{...input,body:'另一处的草稿',request_id:randomUUID()})]);assert.equal(race.filter(r=>r.status===200).length,1);assert.equal(race.filter(r=>r.status===409).length,1);
 const result=await v.http('/drafts/'+archive.id);assert.equal(result.status,200);assert.equal(result.body.retention_days,30);assert.equal(result.body.draft.version,1);assert.equal((await v.call('get_archive',{id:archive.id})).archive.version,1);assert.equal((await v.call('list_archive_events',{id:archive.id})).events.length,1);
 checks.push('drafts persist with a 30-day limit; concurrent drafts conflict without touching archive activity or history');
 const password=randomBytes(24).toString('hex'),next=randomBytes(24).toString('hex');member=await v.call('create_member',{username:'draft-'+randomUUID().slice(0,8),name:'虚构草稿成员',temporary_password:password,request_id:randomUUID()});let cookie;
 async function memberHttp(path,body){const r=await fetch(v.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Connection:'close',Origin:v.base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json()};}
 assert.equal((await memberHttp('/auth/login',{username:member.username,password})).status,200);assert.equal((await memberHttp('/auth/password',{current_password:password,new_password:next})).status,200);assert.equal((await memberHttp('/auth/login',{username:member.username,password:next})).status,200);
 assert.equal((await memberHttp('/drafts/'+archive.id)).body.draft,null);assert.equal((await memberHttp('/drafts/save',{...input,request_id:randomUUID()})).status,200);assert.equal((await v.http('/drafts/'+archive.id)).body.draft.body,result.body.draft.body);
 assert.equal((await memberHttp('/drafts/save',{...input,member_id:v.actor.id,request_id:randomUUID()})).status,400);
 checks.push('members have separate drafts for the same archive and cannot supply another draft owner');
 const draft=result.body.draft;
 const published=await v.call('create_observation',{archive_id:archive.id,body:draft.body,occurred_at:draft.occurred_at,request_id:draft.publish_request_id});
 const resumed=(await v.http('/drafts/'+archive.id)).body;assert.equal(resumed.published.id,published.id);
 const replay=await v.call('create_observation',{archive_id:archive.id,body:draft.body,occurred_at:draft.occurred_at,request_id:draft.publish_request_id});assert.equal(replay.replayed,true);
 assert.equal((await v.http('/drafts/save',{...input,expected_version:draft.version,body:'',request_id:randomUUID()})).status,200);
 assert.equal((await v.http('/drafts')).body.drafts.some(d=>d.archive_id===archive.id),false);assert.equal((await memberHttp('/drafts/'+archive.id)).body.draft.body,input.body);
 checks.push('a draft retains its publication request across reloads, recognizes committed publication and clears only its own version');
}finally{if(member){const m=(await v.call('get_member',{id:member.id})).member;if(!m.frozen)await v.call('set_member_frozen',{id:m.id,expected_version:m.version,frozen:true,request_id:randomUUID()});}await v.close(checks);}
