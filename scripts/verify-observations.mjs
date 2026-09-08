import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('observations'),checks=[];
let member;
try{
 const archive=await v.call('create_archive',{type:'person',name:'虚构文字观察验收 '+randomUUID().slice(0,8),request_id:randomUUID()});
 const input={archive_id:archive.id,body:'第一段：虚构观察。\n\n第二段保留换行与材料时间。',occurred_at:'2024-03-02T10:00:00.000Z',request_id:randomUUID()};
 const result=await v.http('/observations/create',input);assert.equal(result.status,200,'a member publishes a real text observation');
 const replay=await v.call('create_observation',input);assert.equal(replay.id,result.body.id);assert.equal(replay.replayed,true);
 let record=(await v.call('get_observation',{id:result.body.id})).observation;assert.equal(record.body,input.body);assert.equal(record.occurred_at,input.occurred_at);assert.ok(record.created_at>input.occurred_at);assert.equal(record.author_id,v.actor.id);
 assert.equal((await v.call('get_archive',{id:archive.id})).archive.observation_count,1);
 checks.push('web/MCP publication shares one record, keeps the original author and distinguishes material time from submission');
 const nop=await v.call('update_observation',{id:record.id,expected_version:record.version,body:record.body,occurred_at:record.occurred_at,request_id:randomUUID()});assert.equal(nop.changed,false);
 const edit={id:record.id,expected_version:record.version,body:'修改后的虚构观察',occurred_at:null,request_id:randomUUID()};
 const race=await Promise.all([v.http('/observations/update',edit),v.http('/observations/update',{...edit,body:'并发的另一份文字',request_id:randomUUID()})]);assert.equal(race.filter(r=>r.status===200).length,1);assert.equal(race.filter(r=>r.status===409).length,1);
 const versions=await v.call('list_observation_versions',{id:record.id,limit:1});assert.equal(versions.versions.length,1);assert.ok(versions.next_cursor);const old=await v.call('list_observation_versions',{id:record.id,before:versions.next_cursor,limit:1});assert.equal(old.versions[0].body,input.body);
 checks.push('no-op editing adds no version and concurrent edits commit once, preserving paginated previous content');
 const secret=randomBytes(24).toString('hex'),password=randomBytes(24).toString('hex');member=await v.call('create_member',{username:'observation-'+randomUUID().slice(0,8),name:'虚构普通观察员',temporary_password:secret,request_id:randomUUID()});
 let cookie;async function memberHttp(path,body){const r=await fetch(v.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Connection:'close',Origin:v.base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json()};}
 assert.equal((await memberHttp('/auth/login',{username:member.username,password:secret})).status,200);assert.equal((await memberHttp('/auth/password',{current_password:secret,new_password:password})).status,200);assert.equal((await memberHttp('/auth/login',{username:member.username,password})).status,200);
 record=(await v.call('get_observation',{id:record.id})).observation;
 assert.equal((await memberHttp('/observations/update',{...edit,expected_version:record.version,request_id:randomUUID()})).status,403);
 const own=await memberHttp('/observations/create',{...input,body:'普通成员的虚构原文',request_id:randomUUID()});assert.equal(own.status,200);
 await v.call('update_observation',{id:own.body.id,expected_version:1,body:'管理员修订文字，作者保持不变',occurred_at:null,request_id:randomUUID()});assert.equal((await v.call('get_observation',{id:own.body.id})).observation.author_id,member.id);
 checks.push('ordinary members cannot edit another author, while administrator edits preserve original authorship');
 const timeline=await v.call('list_archive_timeline',{id:archive.id});assert.equal(timeline.events.filter(e=>e.observation).length,2);assert.ok(timeline.events.some(e=>e.kind==='observation.edited'&&!e.observation)===false||timeline.events.length>=4);
 const list=await v.call('list_observations',{archive_id:archive.id,limit:1});assert.equal(list.observations.length,1);assert.ok(list.next_cursor);
 const current=(await v.call('get_archive',{id:archive.id})).archive;await v.call('set_archive_state',{id:archive.id,expected_version:current.version,status:'已弃用',member_ids:[],request_id:randomUUID()});
 assert.equal((await v.http('/observations/create',{...input,request_id:randomUUID()})).status,409);assert.equal((await v.http('/observations/update',{...edit,expected_version:record.version,request_id:randomUUID()})).status,409);
 assert.equal((await v.http('/observations/create',{...input,body:' \n ',request_id:randomUUID()})).status,400);
 checks.push('latest observation cards appear once in timeline, record lists paginate and closed archives reject new or edited content');
}finally{
 if(member){const current=(await v.call('get_member',{id:member.id})).member;if(!current.frozen)await v.call('set_member_frozen',{id:member.id,expected_version:current.version,frozen:true,request_id:randomUUID()});}
 await v.close(checks);
}
