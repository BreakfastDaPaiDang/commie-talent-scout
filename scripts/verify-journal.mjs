import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
const base='http://127.0.0.1:8792';
assert.equal((await fetch(base+'/api/health',{headers:{Connection:'close'}}).then(r=>r.json())).environment,'staging');
mkdirSync('tmp/verification',{recursive:true});
function sql(command){writeFileSync('tmp/verification/journal-fixture.sql',command);const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cts-staging','--env','staging','--local','--file','tmp/verification/journal-fixture.sql','--json'],{encoding:'utf8'});assert.equal(r.status,0,'journal management fixture succeeds');return JSON.parse(r.stdout.slice(r.stdout.indexOf('['))).flatMap(x=>x.results??[]);}
const ids=[randomUUID(),randomUUID(),randomUUID()],checks=[];
const before=sql('SELECT count(*) n FROM members')[0].n;
for(const [i,days] of [1,31,181].entries())sql(`INSERT INTO mcp_calls(id,member_id,credential_id,tool,contract_version,started_at,outcome,parameters_json,result_json) VALUES('${ids[i]}','synthetic','synthetic','whoami','verification','${new Date(Date.now()-days*86400000).toISOString()}','success','{"synthetic":true}','{"returned":true}')`);
const scheduledResponse=await fetch(base+'/__scheduled',{headers:{Connection:'close'}});assert.equal(scheduledResponse.status,200);assert.equal(await scheduledResponse.text(),'Ran scheduled event');
const current=sql(`SELECT id,parameters_json,result_json,body_state FROM mcp_calls WHERE id IN (${ids.map(x=>"'"+x+"'").join(',')})`);
assert.equal(current.length,2);assert.ok(current.find(x=>x.id===ids[0]).parameters_json);assert.equal(current.find(x=>x.id===ids[1]).parameters_json,null);assert.equal(current.find(x=>x.id===ids[1]).result_json,null);assert.equal(current.find(x=>x.id===ids[1]).body_state,'expired');assert.equal(sql('SELECT count(*) n FROM members')[0].n,before);
checks.push('actual scheduled Worker clears 31-day bodies and 181-day metadata, retaining recent data and members');
sql(`DELETE FROM mcp_calls WHERE id IN (${ids.map(x=>"'"+x+"'").join(',')})`);
const admin=JSON.parse(readFileSync('secrets/bootstrap-staging-local-admin.json','utf8'));
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Connection:'close',Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:admin.username,password:admin.password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
const connection=await fetch(base+'/api/connections',{method:'POST',headers:{Connection:'close',Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'留存故障验收',days:1})}).then(r=>r.json());assert.ok(connection.secret);
const client=new Client({name:'cts-journal-fault',version:'0.1.0'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Connection:'close',Authorization:'Bearer '+connection.secret}}}));
let moved=false;
try{
  // Local isolated database only. The real request must still succeed while collection storage is unavailable.
  sql('ALTER TABLE mcp_calls RENAME TO mcp_calls_verification_backup');moved=true;
  const result=await client.callTool({name:'whoami',arguments:{}});assert.equal(result.isError,undefined);assert.equal(result.structuredContent.service,'commie-talent-scout');
  assert.ok(sql("SELECT count FROM mcp_diagnostics WHERE kind='collection_start_failed'").some(x=>x.count>0));
  checks.push('authenticated tool success survives unavailable journal storage and emits a body-free diagnostic');
}finally{
  if(moved)sql('ALTER TABLE mcp_calls_verification_backup RENAME TO mcp_calls');
  await client.close().catch(()=>{});
  await fetch(base+'/api/connections/revoke',{method:'POST',headers:{Connection:'close',Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({id:connection.id})});
  await fetch(base+'/api/auth/logout',{method:'POST',headers:{Connection:'close',Origin:base,Cookie:cookie}});
}
writeFileSync('tmp/verification/journal-local.json',JSON.stringify({date:new Date().toISOString(),base,checks},null,2));console.log(JSON.stringify({checks,passed:true}));



