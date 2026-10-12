import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';

test('archive task count and paginated list include every open task, independently of owner, deadline and old summary cap',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'web');
 for(const [type,status] of [['person','个人接触'],['person','已入伙'],['org','视奸观察']]){
  const a=await archives.create({type,status,name:'关联任务验收 '+status,request_id:uuid()});
  for(let n=0;n<53;n++)await tasks.create({archive_id:a.id,kind:'custom',title:'任务 '+n,purpose:'跟进',delivery:'记录结果',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});
  const first=await tasks.list({archive_id:a.id,scope:'all',state:'open',limit:50});assert.equal(first.tasks.length,50);assert.equal(first.next_offset,50);
  const second=await tasks.list({archive_id:a.id,scope:'all',state:'open',limit:50,offset:first.next_offset});assert.equal(second.tasks.length,3);assert.equal(second.next_offset,null);
  const closed=first.tasks[0],claimed=first.tasks[1];await tasks.cancel({id:closed.id,expected_version:closed.version,reason:'验收关闭',request_id:uuid()});await tasks.claim({id:claimed.id,expected_version:claimed.version,request_id:uuid()});
  f.sqlite.prepare("UPDATE work_tasks SET deadline_at='2020-01-01T00:00:00.000Z' WHERE id=?").run(claimed.id);
  const detail=(await archives.detail(a.id)).archive;assert.equal(detail.open_task_count,52);assert.equal(detail.work_tasks.length,30);
  const open=await tasks.list({archive_id:a.id,state:'open',limit:100});assert.equal(open.tasks.length,52);assert.equal(open.tasks.find(t=>t.id===claimed.id).owner_id,f.actor.id);assert.ok(!open.tasks.some(t=>t.id===closed.id));
  assert.deepEqual((await tasks.list({archive_id:a.id,state:'closed'})).tasks.map(t=>t.id),[closed.id]);
 }
});
