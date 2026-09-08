import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('compression-web'),checks=[];
try{
 const report=JSON.parse(readFileSync('tmp/verification/codex-compression-detail-cloud.json','utf8'));assert.equal(v.target,'cloud');
 const expected=report.artifacts.observations.find(o=>o.body.includes('聊天整理')),id=expected.archive_id;
 const archive=await v.http('/archives/'+id);assert.equal(archive.status,200);assert.equal(archive.body.archive.name,report.fixture);
 const record=await v.http('/observations/'+expected.id);assert.equal(record.status,200);assert.equal(record.body.observation.body,expected.body);assert.equal(record.body.observation.author_id,expected.author_id);
 const tags=await v.http('/archives/'+id+'/tags');assert.equal(tags.status,200);for(const tag of report.artifacts.tags){const actual=tags.body.tags.find(t=>t.tag_id===tag.tag_id);assert.ok(actual);assert.deepEqual(actual.evidence,tag.evidence);}
 const timeline=await v.http('/archives/'+id+'/timeline');assert.equal(timeline.status,200);assert.ok(timeline.body.events.some(e=>e.kind==='archive.tags_changed'));assert.ok(timeline.body.events.some(e=>e.observation?.id===expected.id));
 const list=await v.http('/archives?type=person&query='+encodeURIComponent(report.fixture));assert.equal(list.status,200);assert.equal(list.body.archives[0].tag_summary.total,tags.body.tags.length);assert.ok(list.body.archives[0].tag_summary.tags.length<=3);assert.ok(!JSON.stringify(list.body.archives[0]).includes('evidence'));
 checks.push('independent authenticated web API reads match real Codex observation, author, tag evidence and history; list returns bounded visible summaries');
 const entry=await fetch(archive.body.archive.url);assert.equal(entry.status,200);assert.ok((await entry.text()).includes('/assets/'));checks.push('returned archive deep link resolves to the real web application; browser opening is checked separately');
}finally{await v.close(checks);}
