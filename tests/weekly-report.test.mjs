import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {fixture} from './d1-fixture.mjs';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {WorkOverview} from '../app/server/work-overview.ts';
import {weeklyReport} from '../app/server/weekly-report.ts';
import {weeklyReportDocument,weeklyReportQuery,statisticsQueryFromSearch} from '../app/shared/weekly-report.ts';
import {shiftDate} from '../app/shared/statistics.ts';

test('weekly window starts Monday in Shanghai, including UTC Sunday and a year boundary',()=>{
 assert.deepEqual(weeklyReportQuery(new Date('2026-11-01T16:00:00Z')),{from:'2026-11-02',to:'2026-11-02',group:'user',archive_type:'all',interval:'day',search:''});
 assert.equal(weeklyReportQuery(new Date('2026-11-01T15:59:59Z')).from,'2026-10-26');
 assert.equal(weeklyReportQuery(new Date('2027-01-01T00:00:00Z')).from,'2026-12-28');
 assert.equal(weeklyReportQuery(new Date('2026-11-07'),{group:'user',archive_type:'all',search:'ignore',from:'2000-01-01',interval:'month'}).search,'');
 const q=weeklyReportQuery(new Date(),{group:'tag',archive_type:'org'});assert.equal(q.search,'');assert.equal(q.interval,'day');assert.equal(q.archive_type,'org');
 assert.deepEqual(statisticsQueryFromSearch('?'+new URLSearchParams(q)),q);
});

test('weekly export combines all four views, keeps current backlog without a weekly observation, and does not mutate data',async t=>{
 const f=fixture();t.after(f.close);const archives=new Archives(f.env,f.actor,'web'),observations=new Observations(f.env,f.actor,'web');
 const person=await archives.create({type:'person',name:'本周有记录',request_id:id()}),idle=await archives.create({type:'person',name:'长期未更新',request_id:id()});
 const org=await archives.create({type:'org',name:'测试组织',request_id:id()});
 const fresh=await observations.create({archive_id:person.id,body:'本周记录',request_id:id()}),old=await observations.create({archive_id:idle.id,body:'上周记录',request_id:id()});
 const removed=await observations.create({archive_id:person.id,body:'已删除记录',request_id:id()});await observations.setDeleted({id:removed.id,expected_version:1,request_id:id()},true);
 await observations.create({archive_id:org.id,body:'本周组织记录',request_id:id()});
 const q=weeklyReportQuery(),oldTime=new Date(shiftDate(q.from,-1)+'T23:59:59+08:00').toISOString();f.sqlite.prepare('UPDATE observations SET created_at=? WHERE id=?').run(oldTime,old.id);
 const resource={entity:'resource',id:id(),expected_version:0,name:'支持群',kind:'群聊',purposes:['contact'],capacity:null,active:true,note:'',request_id:id()};await new WorkOverview(f.env,f.actor).save(resource);
 const count=f.sqlite.prepare('SELECT count(*) n FROM commands').get().n;
 const result=await weeklyReport(f.env,f.actor,{});assert.equal(result.from,q.from);assert.equal(result.to,q.to);assert.equal(result.statistics.total,2);assert.equal(result.statistics.archives,2);assert.equal(result.overview.people.length,3);assert.ok(result.overview.people.some(p=>p.id===idle.id));assert.equal(result.overview.resources[0].capacity,null);assert.equal(result.statistics.query.search,'');
 const doc=weeklyReportDocument(result);assert.equal(doc.schema_version,'1.0.0');assert.equal(Object.keys(doc.charts).length,4);assert.equal(doc.charts.submission_trend.total,2);assert.equal(doc.charts.internal_resources.distribution[0].unknown_capacity_count,1);assert.equal(doc.charts.internal_resources.resources[0].capacity,null);assert.equal(doc.charts.follow_up_forecast.points.length,31);assert.equal(result.generated_at,result.overview.as_of);
 const organizations=await weeklyReport(f.env,f.actor,{archive_type:'org',group:'type'});assert.equal(organizations.statistics.total,1);assert.deepEqual(organizations.overview.people.map(p=>p.id),[org.id]);assert.equal(organizations.overview.resources.length,1);
 const people=await weeklyReport(f.env,f.actor,{archive_type:'person'});assert.equal(people.statistics.total,1);assert.equal(people.overview.people.length,2);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM commands').get().n,count);
 f.sqlite.prepare('UPDATE archives SET closed=1 WHERE id=?').run(person.id);const closed=await weeklyReport(f.env,f.actor,{});assert.equal(closed.statistics.total,2);assert.ok(!closed.overview.people.some(p=>p.id===person.id));
 f.sqlite.prepare('UPDATE archives SET deleted=1 WHERE id=?').run(person.id);const deleted=await weeklyReport(f.env,f.actor,{});assert.equal(deleted.statistics.total,1);
 assert.equal(f.sqlite.prepare('SELECT content_version FROM observations WHERE id=?').get(fresh.id).content_version,1);
 await assert.rejects(weeklyReport(f.env,f.actor,{archive_type:'invalid'}));
});
