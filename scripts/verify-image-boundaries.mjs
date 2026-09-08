import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('image-boundaries'),checks=[],fixture={};let connection,second;
const png=readFileSync(new URL('../tests/fixtures/images/shapes.png',import.meta.url));
async function sql(text){const file=`tmp/verification/image-boundary-fixture-${v.target}.sql`;writeFileSync(file,text);const env={...process.env,NODE_OPTIONS:'--dns-result-order=ipv4first --no-network-family-autoselection'};for(const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'])delete env[name];const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cts-staging','--env','staging',v.target==='cloud'?'--remote':'--local','--command',text,'--json'],{encoding:'utf8',env});assert.equal(r.status,0,r.stderr+' '+r.stdout.slice(-1800));return JSON.parse(r.stdout.slice(r.stdout.search(/^\s*\[/m)))[0].results;}
const meta=bytes=>({mime_type:'image/png',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
async function prepare(id,bytes=png,purpose='observation'){return v.call('prepare_image_upload',{purpose,archive_id:id,...meta(bytes)});}
async function put(t,bytes=png){const r=await fetch(t.url,{method:'PUT',headers:{...t.headers,Connection:'close'},body:bytes});return {status:r.status,body:await r.json()};}
async function uploaded(id,bytes=png,purpose='observation'){const t=await prepare(id,bytes,purpose),r=await put(t,bytes);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.attachment;}
try{
 const a=await v.call('create_archive',{type:'person',name:'虚构图像边界 '+randomUUID().slice(0,8),request_id:randomUUID()});fixture.archive_id=a.id;
 const chunk=Buffer.alloc(10485760-png.length);chunk.writeUInt32BE(chunk.length-12,0);chunk.write('npAD',4);chunk.writeUInt32BE(crc32(chunk.subarray(4,chunk.length-4)),chunk.length-4);const maximum=Buffer.concat([png.subarray(0,png.length-12),chunk,png.subarray(png.length-12)]);assert.equal(maximum.length,10485760);
 const start=performance.now(),large=await uploaded(a.id,maximum);fixture.maximum_upload_ms=Math.round(performance.now()-start);assert.equal(large.byte_size,10485760);assert.equal(large.width,240);
 const ticket=await prepare(a.id),race=await Promise.all([put(ticket),put(ticket)]);assert.equal(race.filter(r=>r.status===200).length,1);assert.ok(race.filter(r=>r.status!==200).every(r=>[409,429].includes(r.status)));assert.equal((await v.call('get_upload_status',{upload_id:ticket.upload_id})).state,'ready');
 const images=[large.id,ticket.attachment_id];for(let i=2;i<10;i++)images.push((await uploaded(a.id)).id);
 const record=await v.call('create_observation',{archive_id:a.id,body:'虚构十图边界',attachment_ids:images,request_id:randomUUID()});fixture.observation_id=record.id;assert.equal((await v.call('get_observation',{id:record.id})).observation.attachments.length,10);
 assert.equal((await v.http('/observations/create',{archive_id:a.id,attachment_ids:[...images,randomUUID()],request_id:randomUUID()})).status,400);
 await v.call('update_observation',{id:record.id,expected_version:1,body:'当前版本只剩文字；历史十图保留',occurred_at:null,attachment_ids:[],request_id:randomUUID()});assert.equal((await v.call('list_observation_versions',{id:record.id})).versions[1].attachments.length,10);
 checks.push('exact 10 MiB valid PNG and ten ordered images succeed; eleven images fail; concurrent same-ticket upload has one winner; removing all current images preserves ten historical references');
 const contested=await uploaded(a.id),creating=await Promise.all([1,2].map(()=>v.http('/observations/create',{archive_id:a.id,attachment_ids:[contested.id],request_id:randomUUID()})));assert.equal(creating.filter(r=>r.status===200).length,1);assert.ok(creating.filter(r=>r.status!==200).every(r=>[400,409].includes(r.status)));const refs=await sql(`SELECT count(DISTINCT observation_id) n FROM version_attachments WHERE attachment_id='${contested.id}';`);assert.equal(refs[0].n,1);
 connection=(await v.http('/connections',{name:'票据撤销边界',days:1})).body;second=new Client({name:'image-revocation-verifier',version:'0.1.0'});await second.connect(new StreamableHTTPClientTransport(new URL(v.base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+connection.secret}}}));
 const issued=await second.callTool({name:'prepare_image_upload',arguments:{purpose:'observation',archive_id:a.id,...meta(png)}});assert.ok(!issued.isError);await v.http('/connections/revoke',{id:connection.id});assert.equal((await put(issued.structuredContent)).body.error.code,'UPLOAD_AUTH_EXPIRED');
 checks.push('concurrent publication cannot claim one uploaded image for two records; revoking the original MCP credential invalidates its otherwise unexpired upload ticket');
 const orphan=await uploaded(a.id),pending=await prepare(a.id),draft=await uploaded(a.id),avatar=await uploaded(a.id,png,'archive_avatar');const current=(await v.call('get_archive',{id:a.id})).archive;
 await v.call('set_avatar',{subject_type:'archive',id:a.id,expected_version:current.version,attachment_id:avatar.id,request_id:randomUUID()});await v.call('set_avatar',{subject_type:'archive',id:a.id,expected_version:current.version+1,attachment_id:null,request_id:randomUUID()});
 assert.equal((await v.http('/drafts/save',{archive_id:a.id,expected_version:0,body:'',occurred_at:null,attachment_ids:[draft.id],request_id:randomUUID()})).status,200);
 const protectedIds=[...images,contested.id,draft.id,avatar.id],allIds=[...protectedIds,orphan.id,pending.attachment_id];await sql(`UPDATE attachments SET created_at='2020-01-01T00:00:00.000Z' WHERE id IN (${allIds.map(i=>"'"+i+"'").join(',')});`);
 fixture.protected_ids=protectedIds;fixture.orphan_ids=[orphan.id,pending.attachment_id];
 if(v.target==='local'){
  const cron=await fetch('http://127.0.0.1:8792/__scheduled?cron=17+*+*+*+*');assert.equal(cron.status,200);await cron.text();
  const remaining=await sql(`SELECT id,state FROM attachments WHERE id IN (${allIds.map(i=>"'"+i+"'").join(',')});`);assert.deepEqual(remaining.map(r=>r.id).sort(),protectedIds.sort());assert.ok(remaining.every(r=>r.state==='ready'));
  for(const id of [large.id,draft.id,avatar.id]){const image=await v.client.callTool({name:'get_image',arguments:{attachment_id:id}});assert.ok(!image.isError);assert.equal(image.content[0].type,'image');}
  checks.push('real scheduled cleanup removes old unbound/pending objects while historical record, current draft and removed-avatar history references remain ready and readable');
 }else checks.push('cloud cleanup fixtures prepared for the next scheduled run; completion must be verified separately');
 writeFileSync(`tmp/verification/image-cleanup-${v.target}.json`,JSON.stringify({date:new Date().toISOString(),base:v.base,...fixture},null,2));
}finally{if(second)await second.close();if(connection)await v.http('/connections/revoke',{id:connection.id});await v.close(checks);}
