import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';

test('task history beyond 100 remains fully reachable without duplicates, including same-time entries',async t=>{
 const f=fixture();t.after(f.close);const s=new WorkTasks(f.env,f.actor,'mcp');
 const task=await s.create({kind:'custom',title:'虚构历史分页',purpose:'验证',delivery:'记录',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 for(let i=0;i<105;i++)await s.addComment({task_id:task.id,body:`评论 ${i}`,request_id:uuid()});
 // Real clocks can tie; pagination must not use timestamps alone.
 f.sqlite.prepare("UPDATE work_task_comments SET created_at='2026-01-01T00:00:00.000Z'").run();
 const first=await s.detail(task.id);assert.equal(first.comments.length,100);assert.equal(first.comments[0].body,'评论 104');
 for(const section of ['comments','events']){
  const ids=first[section].map(x=>x.id);let cursor=first[section+'_next_cursor'];assert.ok(cursor);
  await s.addComment({task_id:task.id,body:'翻页期间的新评论',request_id:uuid()});
  while(cursor){const p=await s.history({id:task.id,section,cursor,limit:2});ids.push(...p.items.map(x=>x.id));cursor=p.next_cursor;}
  assert.equal(ids.length,section==='comments'?105:106);assert.equal(new Set(ids).size,ids.length);
 }
 await assert.rejects(s.history({id:task.id,section:'events',cursor:first.comments_next_cursor}),{code:'INVALID_CURSOR'});
 await assert.rejects(s.history({id:task.id,section:'events',cursor:'bad'}),{code:'INVALID_CURSOR'});
 const other=await s.create({kind:'custom',title:'另一个任务',purpose:'验证',delivery:'记录',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 await assert.rejects(s.history({id:other.id,section:'comments',cursor:first.comments_next_cursor}),{code:'INVALID_CURSOR'});
});

test('continued comment pages recheck deleted observations and comment-body permissions',async t=>{
 const f=fixture();t.after(f.close);const a=new Archives(f.env,f.actor,'mcp'),o=new Observations(f.env,f.actor,'mcp'),s=new WorkTasks(f.env,f.actor,'mcp');
 const archive=await a.create({type:'person',name:'虚构权限分页',request_id:uuid()});
 const record=await o.create({archive_id:archive.id,body:'受限材料',request_id:uuid()});
 const task=await s.create({archive_id:archive.id,kind:'custom',title:'虚构权限分页',purpose:'验证',delivery:'记录',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
 const comment=await s.addComment({task_id:task.id,body:'原评论',references:[{observation_id:record.id,content_version:record.content_version}],request_id:uuid()});
 await s.addComment({task_id:task.id,body:'新评论',request_id:uuid()});
 const reader=new WorkTasks(f.env,{...f.actor,id:uuid()},'mcp');
 const page=await reader.history({id:task.id,section:'comments',limit:1});
 await o.setDeleted({id:record.id,expected_version:record.version,request_id:uuid()},true);
 await s.deleteComment({id:comment.id,expected_version:comment.version,request_id:uuid()});
 const next=await reader.history({id:task.id,section:'comments',cursor:page.next_cursor});
 assert.equal(next.next_cursor,null);assert.equal(next.items[0].body,null);assert.deepEqual(next.items[0].references,[]);assert.ok(next.items[0].history.every(v=>v.body===null&&v.references.length===0));
 f.actor.role='admin';f.sqlite.prepare("UPDATE members SET role='admin' WHERE id=?").run(f.actor.id);
 const current=await a.get(archive.id);await a.setDeleted({id:archive.id,expected_version:current.version,request_id:uuid()},true);
 await assert.rejects(reader.history({id:task.id,section:'comments',cursor:page.next_cursor}),{code:'NOT_FOUND'});
});
