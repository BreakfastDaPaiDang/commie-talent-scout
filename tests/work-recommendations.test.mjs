import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {WorkOverview} from '../app/server/work-overview.ts';
import {WorkRecommendations} from '../app/server/work-recommendations.ts';
import {matchingTerms} from '../app/shared/work-recommendations.ts';
const deadline='2099-01-01T00:00:00.000Z';
async function setup(f){
 const archives=new Archives(f.env,f.actor,'web'),observations=new Observations(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'web'),overview=new WorkOverview(f.env,f.actor),recommendations=new WorkRecommendations(f.env,f.actor);
 const a=await archives.create({type:'person',name:'待对接的人',request_id:id()});
 const o=await observations.create({archive_id:a.id,body:'希望参与剪辑，想找人一起制作视频。每周两个晚上有时间。',request_id:id()});
 const r={entity:'resource',id:id(),expected_version:0,name:'剪辑协作群',kind:'群聊',purposes:['contact'],capacity:null,active:true,note:'可以交流视频制作和剪辑',request_id:id()};await overview.save(r);
 const candidate=(await recommendations.read({archive_id:a.id})).candidates[0];
 const accept={archive_id:a.id,title:'协调一次剪辑对接',purpose:'确认双方意愿并安排联系',delivery:'新增观察说明实际对接结果',deadline_at:deadline,handoff:{observation_id:o.id,content_version:1,target_kind:candidate.kind,target_id:candidate.id,target_version:candidate.version,target_fingerprint:candidate.fingerprint,owner_id:f.actor.id},request_id:id()};
 return {a,o,r,accept,archives,observations,tasks,overview,recommendations};
}
test('matching needs a specific common topic; it does not turn generic needs into recommendations',()=>{
 assert.deepEqual(matchingTerms('希望参与工作，需要帮助','工作项目提供帮助'),[]);
 assert.ok(matchingTerms('希望学习剪辑','剪辑协作群').includes('剪辑'));
 assert.deepEqual(matchingTerms('现在不想剪辑','剪辑协作群'),[]);
});
test('people candidates use visible enabled tags, detect changed definitions, and exclude closed people',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),helper=await s.archives.create({type:'person',name:'协作人',request_id:id()}),category=id(),tag=id(),at=new Date().toISOString();
 f.sqlite.prepare("INSERT INTO tag_categories(id,type,name,name_key,created_at,updated_at) VALUES(?,'person','技能','skill',?,?)").run(category,at,at);
 f.sqlite.prepare("INSERT INTO tags(id,category_id,name,name_key,description,created_at,updated_at) VALUES(?,?,'剪辑','editing','能够剪辑视频',?,?)").run(tag,category,at,at);
 f.sqlite.prepare('INSERT INTO archive_tags(archive_id,tag_id,added_by,added_at,confirmed_by,confirmed_at,evidence_json) VALUES(?,?,?,?,?,?,?)').run(helper.id,tag,f.actor.id,at,f.actor.id,at,JSON.stringify([{kind:'observation',observation_id:s.o.id,content_version:1,note:'剪辑技能'}]));
 let result=await s.recommendations.read({archive_id:s.a.id});assert.equal(result.candidates.filter(c=>c.kind==='person')[0].id,helper.id);
 const candidate=result.candidates.find(c=>c.kind==='person'),input={...s.accept,handoff:{...s.accept.handoff,target_kind:'person',target_id:candidate.id,target_version:candidate.version,target_fingerprint:candidate.fingerprint},request_id:id()};
 f.sqlite.prepare("UPDATE tags SET description='剪辑视频但本周无时间',version=version+1 WHERE id=?").run(tag);
 await assert.rejects(s.tasks.create(input),{code:'RECOMMENDATION_CHANGED'});
 f.sqlite.prepare("UPDATE tags SET description='能够剪辑视频' WHERE id=?").run(tag);
 const accepted=await s.tasks.create(input);assert.ok(accepted.id);
 f.sqlite.prepare('UPDATE tags SET enabled=0 WHERE id=?').run(tag);assert.equal((await s.recommendations.read({archive_id:s.a.id})).candidates.some(c=>c.kind==='person'),false);
 f.sqlite.prepare('UPDATE tags SET enabled=1 WHERE id=?').run(tag);f.sqlite.prepare('UPDATE archives SET closed=1 WHERE id=?').run(helper.id);assert.equal((await s.recommendations.read({archive_id:s.a.id})).candidates.some(c=>c.kind==='person'),false);
});
test('source archive changed after matching rejects the whole adoption',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),batch=f.env.DB.batch;
 f.env.DB.batch=async statements=>{f.sqlite.prepare('UPDATE archives SET version=version+1 WHERE id=?').run(s.a.id);return batch(statements);};
 await assert.rejects(s.tasks.create(s.accept),{code:'PRECONDITION_CHANGED'});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,0);
});
test('transaction guards reject a candidate becoming unavailable after validation without leaving a task or receipt',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),batch=f.env.DB.batch;
 f.env.DB.batch=async statements=>{f.sqlite.prepare('UPDATE work_overview_resources SET active=0,version=version+1 WHERE id=?').run(s.r.id);return batch(statements);};
 await assert.rejects(s.tasks.create(s.accept),{code:'PRECONDITION_CHANGED'});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_recommendation_links').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM commands WHERE request_id=?').get(s.accept.request_id).n,0);
});
test('read uses submitted full observation, excludes zero/disabled resources but accepts unrelated or free purposes, and does not write',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f);
 for(const patch of [{capacity:0},{active:false},{purposes:['声音制作']}])await s.overview.save({...s.r,id:id(),request_id:id(),...patch});
 const before=f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n;
 const data=await s.recommendations.read({archive_id:s.a.id});assert.equal(data.candidates.length,2);assert.ok(data.candidates.some(c=>c.id===s.r.id));assert.match(data.candidates[0].conditions[0],/待确认/);assert.equal(data.evidence.id,s.o.id);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,before);
 await s.observations.update({id:s.o.id,expected_version:1,body:'近况。'.repeat(130)+'希望剪辑',occurred_at:null,request_id:id()});assert.equal((await s.recommendations.read({archive_id:s.a.id})).candidates.length,2);
});
test('acceptance atomically creates assigned task, immutable evidence link and visible source comment; repeats reuse',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),before=(await s.overview.read({})).people[0].due_at;
 const done=await s.tasks.create(s.accept);assert.equal(done.owner_id,f.actor.id);assert.equal((await s.tasks.create(s.accept)).replayed,true);
 assert.equal((await s.tasks.create({...s.accept,request_id:id()})).id,done.id);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_recommendation_links').get().n,1);
 const task=(await s.tasks.detail(done.id));assert.equal(task.task.requires_observation_reference,true);assert.equal(task.comments[0].references[0].observation_id,s.o.id);assert.match(task.comments[0].body,/剪辑/);
 assert.equal((await s.overview.read({})).people[0].due_at,before);
 f.sqlite.prepare('UPDATE observations SET created_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z',s.o.id);
 await assert.rejects(s.tasks.complete({id:done.id,expected_version:1,result_kind:'completed',result_text:'完成',references:[{observation_id:s.o.id,content_version:1}],request_id:id()}),{code:'CURRENT_ROUND_OBSERVATION_REQUIRED'});
 const fresh=await s.observations.create({archive_id:s.a.id,body:'已确认双方意愿，约定周末参与剪辑',request_id:id()});
 await s.tasks.complete({id:done.id,expected_version:1,result_kind:'completed',result_text:'已安排周末参与',references:[{observation_id:fresh.id,content_version:1}],request_id:id()});
 const accepted=(await s.recommendations.read({archive_id:s.a.id})).accepted[0];assert.equal(accepted.status,'completed');assert.equal(accepted.result_text,'已安排周末参与');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mutation_guards').get().n,0);
});
test('stale observation and candidate versions reject without partial tasks',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f);
 await s.observations.update({id:s.o.id,expected_version:1,body:'现在暂不参与剪辑',occurred_at:null,request_id:id()});
 await assert.rejects(s.tasks.create(s.accept),{code:'EVIDENCE_CHANGED'});
 await s.overview.save({...s.r,expected_version:1,active:false,request_id:id()});
 await assert.rejects(s.tasks.create({...s.accept,handoff:{...s.accept.handoff,content_version:2},request_id:id()}),{code:'RECOMMENDATION_CHANGED'});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,0);
});
test('members may accept for themselves; only admins may explicitly assign others',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),other=id();
 f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,?)").run(other,'helper','协作成员',new Date().toISOString());
 const input={...s.accept,handoff:{...s.accept.handoff,owner_id:other}};
 await assert.rejects(s.tasks.create(input));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks').get().n,0);
 f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);f.actor.role='admin';
 assert.equal((await s.tasks.create(input)).owner_id,other);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_task_events WHERE kind='task.assigned'").get().n,1);
});
test('target tasks are candidates without being assigned or consumed by the recommendation',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),target=await s.tasks.create({title:'剪辑视频片段',purpose:'制作剪辑作品',delivery:'视频成片',deadline_at:deadline,request_id:id()});
 const candidate=(await s.recommendations.read({archive_id:s.a.id})).candidates.find(c=>c.kind==='task');assert.equal(candidate.id,target.id);
 const adopted=await s.tasks.create({...s.accept,handoff:{...s.accept.handoff,target_kind:'task',target_id:target.id,target_version:1,target_fingerprint:candidate.fingerprint},request_id:id()});assert.notEqual(adopted.id,target.id);assert.equal((await s.tasks.detail(target.id)).task.owner_id,null);
});
test('empty/deleted/cross-archive evidence never generates candidates, deleted archive cannot be used',async t=>{
 const f=fixture();t.after(f.close);const s=await setup(f),other=await s.archives.create({type:'person',name:'无观察',request_id:id()});assert.equal((await s.recommendations.read({archive_id:other.id})).evidence,null);
 await assert.rejects(s.recommendations.read({archive_id:other.id,observation_id:s.o.id}),{code:'EVIDENCE_UNAVAILABLE'});
 await s.observations.setDeleted({id:s.o.id,expected_version:1,request_id:id()},true);assert.equal((await s.recommendations.read({archive_id:s.a.id})).candidates.length,0);
 await assert.rejects(s.tasks.create(s.accept),{code:'EVIDENCE_UNAVAILABLE'});
 f.sqlite.prepare('UPDATE archives SET deleted=1 WHERE id=?').run(other.id);await assert.rejects(s.recommendations.read({archive_id:other.id}));
});
