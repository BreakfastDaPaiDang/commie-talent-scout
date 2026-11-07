import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Resources} from '../app/server/resources.ts';
import {WorkOverview} from '../app/server/work-overview.ts';
import {Archives} from '../app/server/archives.ts';
import {overviewResourceDistribution} from '../app/shared/work-overview.ts';

test('resources work without personnel records, accept free purposes, and preserve receipts and history',async t=>{
 const f=fixture();t.after(f.close);const service=new Resources(f.env,f.actor);
 const input={entity:'resource',id:id(),expected_version:0,request_id:id(),name:'共享录音间'};
 await service.save(input);assert.equal((await service.save(input)).replayed,true);
 let row=(await service.list()).resources[0];assert.equal(row.kind,'');assert.deepEqual(row.purposes,[]);assert.equal(row.capacity,null);
 await service.save({...input,request_id:id(),expected_version:1,kind:'空间',purposes:['播客制作','排练','播客制作'],note:'预约后使用'});
 row=(await service.list({search:'播客'})).resources[0];assert.equal(row.id,input.id);assert.deepEqual(row.purposes,['排练','播客制作']);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM archives').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_overview_history').get().n,2);
 await assert.rejects(service.save({...input,request_id:id()}),{code:'VERSION_CONFLICT'});
 assert.equal(overviewResourceDistribution(await new WorkOverview(f.env,f.actor).read({type:'all'})).length,0);
 await service.save({entity:'resource_delete',id:row.id,expected_version:2,request_id:id()});assert.equal((await service.list()).resources.length,0);
 await assert.rejects(service.save({...input,expected_version:3,request_id:id()}),{code:'RESOURCE_DELETED'});
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mutation_guards').get().n,0);
});

test('personnel distribution uses actual references, not free resource purposes; legacy resource IDs survive',async t=>{
 const f=fixture();t.after(f.close);const resources=new Resources(f.env,f.actor),overview=new WorkOverview(f.env,f.actor);
 const r={entity:'resource',id:id(),expected_version:0,request_id:id(),name:'共用空间',purposes:['设备维修'],capacity:7};await resources.save(r);
 const unused={...r,id:id(),request_id:id(),name:'未引用空间'};await resources.save(unused);
 const a=await new Archives(f.env,f.actor,'web').create({type:'person',name:'资源使用者',request_id:id()});
 const event=f.sqlite.prepare("SELECT id FROM archive_events WHERE archive_id=? AND kind='archive.created'").get(a.id).id;
 await overview.save({entity:'placement',id:id(),archive_id:a.id,event_id:event,expected_version:0,resource_ids:[r.id],usage:'active',note:'本次使用',request_id:id()});
 const before=await overview.read({});let dist=overviewResourceDistribution(before);assert.equal(dist.length,1);assert.equal(dist[0].id,before.people[0].segments[0].type);assert.equal(dist[0].capacity,7);
 await resources.save({...r,expected_version:1,request_id:id(),purposes:['自由协作','培训']});assert.deepEqual(overviewResourceDistribution(await overview.read({})),dist);
 f.sqlite.prepare('UPDATE work_overview_resources SET purposes_json=? WHERE id=?').run('["review"]',unused.id);
 const old=(await resources.list({search:'审核'})).resources.find(v=>v.id===unused.id);assert.deepEqual(old.purposes,['审核']);assert.equal(old.version,1);
 await resources.save({entity:'resource_delete',id:r.id,expected_version:2,request_id:id()});const after=await overview.read({});assert.equal(overviewResourceDistribution(after).length,0);assert.equal(after.people[0].segments[0].placements[0].resource_ids[0],r.id);
});
