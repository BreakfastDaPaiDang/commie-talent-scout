import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {verificationClient} from './verification-client.mjs';
const largeOnly=process.argv.includes('--large-only'),v=await verificationClient(largeOnly?'cloud-image-maximum-read':'cloud-image-cleanup'),checks=[];assert.equal(v.target,'cloud');
try{
 const fixture=JSON.parse(readFileSync('tmp/verification/image-cleanup-cloud.json','utf8'));
 const image=await v.client.callTool({name:'get_image',arguments:{attachment_id:fixture.protected_ids[0]}});assert.ok(!image.isError);assert.equal(image.content[0].type,'image');assert.equal(Buffer.from(image.content[0].data,'base64').length,10485760);checks.push('real cloud MCP image response returns the complete 10 MiB original as standard image content');
 if(!largeOnly){
  const env={...process.env,NODE_OPTIONS:'--dns-result-order=ipv4first --no-network-family-autoselection'};for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'])delete env[key];
  const ids=[...fixture.protected_ids,...fixture.orphan_ids],sql=`SELECT id,state FROM attachments WHERE id IN (${ids.map(id=>"'"+id+"'").join(',')})`;
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cts-staging','--env','staging','--remote','--command',sql,'--json'],{encoding:'utf8',env});assert.equal(result.status,0,result.stdout.slice(-1000));const rows=JSON.parse(result.stdout.slice(result.stdout.search(/^\s*\[/m)))[0].results;
  assert.deepEqual(rows.map(r=>r.id).sort(),[...fixture.protected_ids].sort(),'actual scheduled cleanup must remove both orphan rows and retain all protected references');assert.ok(rows.every(r=>r.state==='ready'));
  const record=(await v.call('get_observation',{id:fixture.observation_id})).observation;assert.equal(record.attachments.length,0);assert.equal((await v.call('list_observation_versions',{id:fixture.observation_id})).versions[1].attachments.length,10);checks.push('actual cloud cron removes old orphan/pending uploads and retains all record history, active draft and removed-avatar history references');
  writeFileSync('tmp/verification/cloud-image-cleanup-complete.json',JSON.stringify({date:new Date().toISOString(),fixture_date:fixture.date,archive_id:fixture.archive_id,checks},null,2));
 }
}finally{await v.close(checks);}
