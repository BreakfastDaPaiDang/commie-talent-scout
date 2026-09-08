import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
const remote=process.argv.includes('--remote'),base=remote?'https://scout-staging.dapaidang.org':'http://127.0.0.1:8790';
assert.equal((await fetch(base+'/api/health').then(r=>r.json())).environment,'staging');
mkdirSync('tmp/verification',{recursive:true});mkdirSync('secrets',{recursive:true});
const admin=JSON.parse(readFileSync(`secrets/bootstrap-staging-${remote?'remote':'local'}-admin.json`,'utf8'));
const report={date:new Date().toISOString(),base,checks:[]},clients=[];
let cookie;
const request=async(path,body,session=cookie)=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(session?{Cookie:session}:{}),...(body!==undefined?{'Content-Type':'application/json',Origin:base}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});return {status:r.status,body:await r.json(),headers:r.headers};};
const ok=r=>{assert.equal(r.status,200);return r.body;};
async function check(name,run){await run();report.checks.push(name);console.log('PASS '+name);}
async function connect(secret){const client=new Client({name:'cts-product-verification',version:'0.1.0'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+secret}}}));clients.push(client);return client;}
function sql(command){writeFileSync('tmp/verification/mcp-fixture.sql',command);const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cts-staging','--env','staging',remote?'--remote':'--local','--file','tmp/verification/mcp-fixture.sql','--json'],{encoding:'utf8'});assert.equal(r.status,0,'management fixture query succeeds');return JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));}
const fixtureId=randomUUID(),fixtureSecret=randomUUID()+randomUUID(),hash=createHash('sha256').update(fixtureSecret).digest('hex');
let token,connectionId;
try{
  await check('public MCP rejects missing authentication',async()=>{assert.equal((await fetch(base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);});
  const login=await request('/api/auth/login',{username:admin.username,password:admin.password},null);ok(login);cookie=login.headers.get('set-cookie').split(';')[0];
  await check('credential creation shows a one-time secret and listing omits hashes and secrets',async()=>{const c=ok(await request('/api/connections',{name:'协议验收 '+new Date().toISOString(),days:1}));token=c.secret;connectionId=c.id;assert.match(token,/^cts_[a-f0-9]{64}$/);const list=ok(await request('/api/connections'));assert.ok(list.credentials.some(x=>x.id===c.id));assert.ok(!JSON.stringify(list).includes(token));assert.ok(list.credentials.every(x=>!('hash'in x)&&!('secret'in x)));writeFileSync(`secrets/mcp-staging-${remote?'remote':'local'}-verification.json`,JSON.stringify({id:connectionId,secret:token,base},null,2),{mode:0o600});});
  const client=await connect(token);
  await check('cold initialized client discovers real capabilities and guides without resources or prior chat',async()=>{const catalog=await client.listTools();for(const name of ['whoami','get_usage_guide','list_connections','revoke_connection']){const t=catalog.tools.find(x=>x.name===name);assert.ok(t?.outputSchema&&t.annotations&&t.description.length>30);}const who=await client.callTool({name:'whoami',arguments:{}});assert.equal(who.structuredContent.service,'commie-talent-scout');assert.equal(who.structuredContent.member.id,login.body.member.id);assert.equal(who.structuredContent.environment,'staging');const guide=await client.callTool({name:'get_usage_guide',arguments:{topic:'connections'}});assert.ok(guide.structuredContent.rules.some(x=>x.includes('新客户端进程')));});
  await check('schema rejection and successful tool calls are journaled as distinct attempts without secrets',async()=>{const invalid=await client.callTool({name:'get_usage_guide',arguments:{topic:'invalid',Authorization:token,password:'excluded'}});assert.ok(invalid.isError);const calls=ok(await request('/api/admin/calls'));const own=calls.calls.filter(x=>x.credential_id===connectionId);assert.ok(own.some(x=>x.tool==='whoami'&&x.outcome==='success'));assert.ok(own.some(x=>x.tool==='get_usage_guide'&&x.outcome==='rejected'));assert.ok(new Set(own.map(x=>x.id)).size===own.length);const stored=JSON.stringify(sql(`SELECT parameters_json,result_json,tool FROM mcp_calls WHERE credential_id='${connectionId}'`));assert.ok(!stored.includes(token)&&!stored.includes('excluded'));});
  await check('ordinary member cannot review calls or access administrator credentials',async()=>{sql(`INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES('${fixtureId}','fixture-${fixtureId}','虚构验收成员','member','!fixture',0,'${new Date().toISOString()}'); INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES('${randomUUID()}','${fixtureId}','${hash}','session','验收会话',1,'${new Date().toISOString()}','${new Date(Date.now()+3600000).toISOString()}');`);const other='cts_session='+fixtureSecret;assert.equal((await request('/api/admin/calls',undefined,other)).status,403);assert.equal((await request('/api/connections/revoke',{id:connectionId},other)).status,404);});
  await check('revocation takes effect on the already connected client and retains its final successful action',async()=>{const result=await client.callTool({name:'revoke_connection',arguments:{id:connectionId}});assert.equal(result.structuredContent.revoked,true);await assert.rejects(()=>client.callTool({name:'whoami',arguments:{}}));const calls=ok(await request('/api/admin/calls'));assert.ok(calls.calls.some(x=>x.tool==='revoke_connection'&&x.credential_id===connectionId&&x.outcome==='success'));});
}finally{
  for(const c of clients)await c.close().catch(()=>{});
  if(cookie){if(connectionId)await request('/api/connections/revoke',{id:connectionId}).catch(()=>{});await request('/api/auth/logout',{}).catch(()=>{});}
  sql(`DELETE FROM credentials WHERE member_id='${fixtureId}'; DELETE FROM members WHERE id='${fixtureId}';`);
  writeFileSync(`tmp/verification/mcp-${remote?'cloud':'local'}.json`,JSON.stringify(report,null,2));
}
console.log(JSON.stringify({base,passed:report.checks.length}));


