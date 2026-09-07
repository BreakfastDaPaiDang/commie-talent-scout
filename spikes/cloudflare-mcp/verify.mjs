import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const credentials = JSON.parse((await readFile(new URL('./test-credentials.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
const { tokens, probeKey } = credentials;
const runId=randomUUID();
const uuid=()=>randomUUID();
const hash=(value)=>createHash('sha256').update(value).digest('hex');
const report={at:new Date().toISOString(),base,runId,checks:[],metrics:{}};
const clients=[];
const signal=()=>AbortSignal.timeout(30000);
async function call(path,member='alice',body,headers={}) {
  const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(member?{Authorization:`Bearer ${tokens[member]}`} : {}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:signal()});
  return {status:response.status,body:await response.json()};
}
async function test(name,action) {
  const start=performance.now();
  try { await action(); report.checks.push({name,pass:true,ms:Math.round(performance.now()-start)}); console.log(`PASS ${name}`); }
  catch(error) { report.checks.push({name,pass:false,error:error.message,ms:Math.round(performance.now()-start)}); console.log(`FAIL ${name}: ${error.message}`); }
}
function ok(result) { assert.equal(result.status,200,JSON.stringify(result.body)); return result.body; }
async function mcp(member='alice',legacy=false,modern=false) {
  const client=legacy?new LegacyClient({name:'cts-legacy-validation',version:'1'}):new Client({name:'cts-modern-validation',version:'1'},modern?{versionNegotiation:{mode:'auto'}}:{});
  const Transport=legacy?LegacyTransport:StreamableHTTPClientTransport;
  await client.connect(new Transport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${tokens[member]}`}}}));
  clients.push(client); return client;
}
async function tool(client,name,args={}) {
  const response=await client.callTool({name,arguments:args});
  return {isError:!!response.isError,body:JSON.parse(response.content.find(x=>x.type==='text').text)};
}
async function freshEntity() { return ok(await call('/api/entities','alice',{name:'虚构技术验证档案',request_id:uuid()})).id; }
let entity,record,aliceClient,bobClient,imageId;

try {
  const setup=await fetch(base+'/probe/setup',{method:'POST',headers:{'X-Probe-Key':probeKey,'Content-Type':'application/json'},body:JSON.stringify({members:Object.entries(tokens).map(([id,token])=>({id,role:id.startsWith('admin')?'admin':'member',tokenHash:hash(token)}))}),signal:signal()});
  assert.equal(setup.status,200,'protected synthetic setup');
  await test('unauthenticated API and MCP rejected',async()=>{
    assert.equal((await call('/api/whoami',null)).status,401);
    const response=await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:signal()});
    assert.equal(response.status,401);
  });
  await test('cookie auth and cross-origin mutation protection',async()=>{
    const response=await fetch(base+'/api/whoami',{headers:{Cookie:`cts_session=${tokens.alice}`},signal:signal()});assert.equal(response.status,200);
    assert.equal((await call('/api/entities',null,{name:'blocked',request_id:uuid()},{Cookie:`cts_session=${tokens.alice}`,Origin:'https://other.invalid'})).status,403);
  });
  await test('MCP SDK v2 tool discovery and identity',async()=>{
    aliceClient=await mcp();bobClient=await mcp('bob');
    const tools=await aliceClient.listTools(); assert(tools.tools.some(t=>t.name==='prepare_image_upload'));
    assert.equal((await tool(aliceClient,'whoami')).body.id,'alice');
    entity=(await tool(aliceClient,'create_entity',{name:'虚构 MCP 档案',request_id:uuid()})).body.id;
    assert(entity);
  });
  await test('legacy 2025 MCP client interoperates with v2 server',async()=>{
    const client=await mcp('alice',true); assert.equal((await tool(client,'whoami')).body.id,'alice');
  });
  await test('2026 MCP negotiation interoperates with stateless handler',async()=>{
    const client=await mcp('alice',false,true); assert.equal((await tool(client,'whoami')).body.id,'alice');
  });
  await test('D1 failed attachment precondition rolls back record and revision',async()=>{
    const before=ok(await call(`/api/entities/${entity}`));
    const result=await call('/api/records','alice',{entity_id:entity,body:'must roll back',attachment_ids:['missing'],request_id:uuid()});
    assert.equal(result.status,409);
    const after=ok(await call(`/api/entities/${entity}`));
    assert.equal(after.records.length,before.records.length);assert.equal(after.revisions.length,before.revisions.length);assert.equal(after.events.length,before.events.length);
  });
  await test('MCP upload ticket -> private R2 -> record -> authenticated read',async()=>{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1Z0AAAAASUVORK5CYII=','base64');
    const upload=(await tool(aliceClient,'prepare_image_upload',{entity_id:entity,mime:'image/png',bytes:png.length,sha256:hash(png)})).body;
    imageId=upload.attachmentId;assert(imageId);
    const put=()=>fetch(base+upload.uploadPath,{method:'PUT',headers:{Authorization:`Bearer ${upload.uploadToken}`,'Content-Type':'image/png'},body:png,signal:signal()});
    assert.equal((await put()).status,200);assert.equal((await put()).status,403,'ticket is one-use');
    record=(await tool(aliceClient,'create_record',{entity_id:entity,body:'虚构的图文观察记录',attachment_ids:[imageId],request_id:uuid()})).body.id;assert(record);
    assert.equal((await fetch(base+`/images/${imageId}`,{signal:signal()})).status,401);
    const image=await fetch(base+`/images/${imageId}`,{headers:{Authorization:`Bearer ${tokens.bob}`},signal:signal()});
    assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'private, no-store');
    assert.equal(hash(Buffer.from(await image.arrayBuffer())),hash(png));
    report.metrics.image={bytes:png.length,sha256:hash(png),authenticatedRead:true};
  });
  await test('author/admin permissions agree between web and MCP',async()=>{
    assert.equal((await call('/api/records/change','bob',{record_id:record,operation:'delete',expected_version:1,request_id:uuid()})).status,403);
    assert.equal((await tool(bobClient,'change_record',{record_id:record,operation:'delete',expected_version:1,request_id:uuid()})).isError,true);
    ok(await call('/api/records/change','admin',{record_id:record,operation:'delete',expected_version:1,request_id:uuid()}));
    assert.equal((await call('/api/records/change','bob',{record_id:record,operation:'restore',expected_version:2,request_id:uuid()})).status,403);
    assert.equal((await tool(aliceClient,'change_record',{record_id:record,operation:'restore',expected_version:2,request_id:uuid()})).isError,false);
    const snapshot=ok(await call(`/api/entities/${entity}`));
    assert.equal(snapshot.records[0].author_id,'alice');assert.equal(snapshot.records[0].deleted,0);assert.equal(snapshot.revisions.length,3);assert.equal(snapshot.attachments[0].record_id,record);
  });
  await test('closed archive rejects authors and admins; reopen restores writing',async()=>{
    ok(await call('/api/state','alice',{entity_id:entity,state:'discarded',expected_version:1,request_id:uuid()}));
    assert.equal((await tool(aliceClient,'create_record',{entity_id:entity,body:'blocked',request_id:uuid()})).isError,true);
    assert.equal((await call('/api/records/change','admin',{record_id:record,operation:'delete',expected_version:3,request_id:uuid()})).status,409);
    ok(await call('/api/state','bob',{entity_id:entity,state:'reviewing',expected_version:2,request_id:uuid()}));
    const snapshot=ok(await call(`/api/entities/${entity}`));
    assert(snapshot.events.some(e=>e.kind==='entity.closed'));assert(snapshot.events.some(e=>e.kind==='entity.opened'));
    assert.equal(snapshot.entity.state,'reviewing');assert.equal(snapshot.entity.closed,0);
  });
  await test('two conflicting edits preserve exactly one new version',async()=>{
    const results=await Promise.all(['first','second'].map(body=>call('/api/records/change','alice',{record_id:record,operation:'edit',body,expected_version:3,request_id:uuid()})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const snapshot=ok(await call(`/api/entities/${entity}`));assert.equal(snapshot.revisions.length,4);
  });
  await test('close/create races never create a record after closure',async()=>{
    for(let i=0;i<5;i++){
      const target=await freshEntity();
      const results=await Promise.all([call('/api/state','bob',{entity_id:target,state:'discarded',expected_version:1,request_id:uuid()}),call('/api/records','alice',{entity_id:target,body:'race',request_id:uuid()})]);
      assert.equal(results[0].status,200);assert([200,409].includes(results[1].status));
      const snapshot=ok(await call(`/api/entities/${target}`));const close=snapshot.events.find(e=>e.kind==='entity.closed');
      assert(!snapshot.events.some(e=>e.kind==='record.created'&&e.seq>close.seq));
    }
  });
  await test('concurrent retried command creates one record and one event',async()=>{
    const commandId=uuid();const input={entity_id:entity,body:'idempotent request',request_id:commandId};
    const results=await Promise.all(Array.from({length:5},()=>call('/api/records','alice',input)));results.forEach(ok);
    assert.equal((await call('/api/records','alice',{...input,body:'different payload'})).status,409);
    const snapshot=ok(await call(`/api/entities/${entity}`));
    assert.equal(snapshot.records.filter(r=>r.id===commandId).length,1);assert.equal(snapshot.events.filter(e=>e.subject_id===commandId).length,1);
  });
  await test('unread is per-member and reads do not alter entity activity',async()=>{
    const before=ok(await call(`/api/entities/${entity}`));
    const alice=ok(await call('/api/unread','alice'));assert(alice.every(e=>e.actor_id!=='alice'));
    const bob=ok(await call('/api/unread','bob'));assert(bob.length>0);
    ok(await call('/api/read','bob',{seq:bob[0].seq}));
    const after=ok(await call(`/api/entities/${entity}`));assert.deepEqual(before.entity,after.entity);
    assert.equal(ok(await call('/api/unread','bob')).length,bob.length-1);
    assert.equal(ok(await call('/api/unread','alice')).length,alice.length);
  });
  await test('freeze invalidates an already connected MCP client and image access',async()=>{
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1Z0AAAAASUVORK5CYII=','base64');
    const pending=(await tool(bobClient,'prepare_image_upload',{entity_id:entity,mime:'image/png',bytes:png.length,sha256:hash(png)})).body;
    ok(await call('/api/members','admin',{member_id:'bob',frozen:true,role:'member',request_id:uuid()}));
    assert.equal((await call('/api/whoami','bob')).status,401);
    let rejected=false;try{await tool(bobClient,'whoami');}catch{rejected=true;}assert(rejected);
    assert.equal((await fetch(base+`/images/${imageId}`,{headers:{Authorization:`Bearer ${tokens.bob}`},signal:signal()})).status,401);
    ok(await call('/api/members','admin',{member_id:'bob',frozen:false,role:'member',request_id:uuid()}));
    assert.equal((await call('/api/whoami','bob')).status,401,'unfreeze cannot resurrect old token');
    const oldTicket=await fetch(base+pending.uploadPath,{method:'PUT',headers:{Authorization:`Bearer ${pending.uploadToken}`,'Content-Type':'image/png'},body:png,signal:signal()});
    assert.equal(oldTicket.status,403,'unfreeze cannot resurrect an old upload ticket');
  });
  await test('concurrent admin demotions leave an active administrator',async()=>{
    const results=await Promise.all([call('/api/members','admin',{member_id:'admin',frozen:false,role:'member',request_id:uuid()}),call('/api/members','admin2',{member_id:'admin2',frozen:false,role:'member',request_id:uuid()})]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const roles=await Promise.all(['admin','admin2'].map(a=>call('/api/whoami',a)));assert.equal(roles.filter(r=>r.body.role==='admin').length,1);
  });
  await test('password KDF runtime probe (scrypt N32768 r8 p3)',async()=>{
    const roles=await Promise.all(['admin','admin2'].map(a=>call('/api/whoami',a)));const admin=['admin','admin2'][roles.findIndex(r=>r.body.role==='admin')];
    const result=await call('/probe/scrypt',admin,{});report.metrics.password=result;assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.bytes,64);
  });
} catch(error) { report.checks.push({name:'harness',pass:false,error:error.message});console.log(`FAIL harness: ${error.message}`); }
finally {
  await Promise.allSettled(clients.map(c=>c.close()));
  report.passed=report.checks.filter(c=>c.pass).length;report.failed=report.checks.filter(c=>!c.pass).length;
  await mkdir(new URL('./test-output/',import.meta.url),{recursive:true});
  await writeFile(new URL(`./test-output/${base.includes('127.0.0.1')?'local':'remote'}-results.json`,import.meta.url),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,failed:report.failed,metrics:report.metrics}));
  process.exitCode=report.failed?1:0;
}
