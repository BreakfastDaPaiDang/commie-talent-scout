import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {WorkTasks} from '../app/server/work-tasks.ts';
import {WorkTaskLabels} from '../app/server/work-task-labels.ts';
import {Archives} from '../app/server/archives.ts';
const input=(extra={})=>({title:'任务',purpose:'实际工作',delivery:'如实交付',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid(),...extra});
test('catalog reuses names, task labels do not change kind, OR filtering occurs before pagination',async t=>{
 const f=fixture();t.after(f.close);const labels=new WorkTaskLabels(f.env,f.actor,'mcp'),tasks=new WorkTasks(f.env,f.actor,'web');
 const request={name:'资料整理',request_id:uuid()},created=await labels.create(request);assert.deepEqual(await labels.create(request),{...created,replayed:true});assert.equal((await labels.create({name:' 资料整理 ',request_id:uuid()})).key,created.key);
 const audit=await labels.create({name:'人事审核',request_id:uuid()});assert.equal(audit.key,'audit');
 await tasks.create(input({labels:['cooperation'],priority:'P0'}));
 const a=await tasks.create(input({labels:[audit.key,created.key],priority:'P1'}));assert.equal(a.kind,'custom');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM archive_events').get().n,0);
 const b=await tasks.create(input({labels:['月度沟通'],priority:'P2'}));assert.equal(b.kind,'custom');
 let page=await tasks.list({labels:[created.key,'monthly'],limit:1});assert.equal(page.tasks[0].id,a.id);assert.equal(page.next_offset,1);page=await tasks.list({labels:[created.key,'monthly'],limit:1,offset:page.next_offset});assert.equal(page.tasks[0].id,b.id);
 assert.equal((await tasks.list({labels:['人事审核'],priority:'P2'})).tasks.length,0);assert.equal((await tasks.list({labels:['人事审核'],priority:'P1'})).tasks[0].id,a.id);
 await tasks.edit({id:a.id,expected_version:a.version,labels:['monthly'],request_id:uuid()});assert.equal((await tasks.detail(a.id)).task.kind,'custom');assert.deepEqual((await tasks.detail(a.id)).task.labels,['月度沟通']);
 assert.equal((await labels.list({query:'资料'})).labels[0].key,created.key);
});
test('catalog supports names beyond first page and does not leak imported deleted-only labels',async t=>{
 const f=fixture();t.after(f.close);const labels=new WorkTaskLabels(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'mcp'),archives=new Archives(f.env,f.actor,'web');
 for(let i=0;i<35;i++)await labels.create({name:'专项'+String(i).padStart(2,'0'),request_id:uuid()});
 const first=await labels.list({query:'专项',limit:30});assert.equal(first.labels.length,30);assert.equal(first.next_offset,30);assert.equal((await labels.list({query:'专项',offset:30})).labels.length,5);assert.equal((await labels.list({query:'专项34'})).labels.length,1);
 const a=await archives.create({type:'person',name:'隐藏对象',request_id:uuid()});await tasks.create(input({archive_id:a.id,labels:['历史隐藏标签']}));f.sqlite.prepare("UPDATE work_task_labels SET created_by=NULL WHERE key='历史隐藏标签'").run();f.sqlite.prepare('UPDATE archives SET deleted=1 WHERE id=?').run(a.id);
 assert.equal((await labels.list({query:'历史隐藏'})).labels.length,0);assert.equal((await tasks.list({labels:['历史隐藏标签']})).tasks.length,0);
 f.actor.role='admin';assert.equal((await labels.list({query:'历史隐藏'})).labels[0].usage_count,1);
});
test('task edit failure rolls back new label registration and retries reuse one label',async t=>{
 const f=fixture();t.after(f.close);const service=new WorkTasks(f.env,f.actor,'mcp'),task=await service.create(input());
 f.sqlite.exec("CREATE TRIGGER reject_edit BEFORE UPDATE ON work_tasks BEGIN SELECT RAISE(ABORT,'fixture'); END;");
 const cmd={id:task.id,expected_version:task.version,labels:['独立标签'],request_id:uuid()};await assert.rejects(service.edit(cmd),/fixture/);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_task_labels WHERE key='独立标签'").get().n,0);f.sqlite.exec('DROP TRIGGER reject_edit');
 await service.edit(cmd);await service.edit(cmd);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_task_labels WHERE key='独立标签'").get().n,1);
});
test('member paused availability roundtrips through creation, filters and state changes',async t=>{
 const f=fixture();t.after(f.close);const service=new Archives(f.env,f.actor,'web');let a=await service.create({type:'person',name:'虚构暂不接工作',status:'已入伙',member_status:'暂不接工作',request_id:uuid()});
 assert.equal((await service.get(a.id)).member_status,'暂不接工作');assert.equal((await service.list({type:'person',person_scope:'members',member_status:'暂不接工作'})).counts.all,1);assert.equal((await service.list({type:'person',member_status:'可接工作'})).counts.all,0);
 for(const state of ['请假','可接工作','暂不接工作','失联']){a=await service.setState({id:a.id,expected_version:a.version,status:'已入伙',member_status:state,member_ids:[],request_id:uuid()});assert.equal((await service.get(a.id)).member_status,state);}
 const before=(await service.get(a.id)).version;const tasks=new WorkTasks(f.env,f.actor,'web');await tasks.create(input({archive_id:a.id}));assert.equal((await service.get(a.id)).member_status,'失联');assert.equal((await service.get(a.id)).version,before);
});
