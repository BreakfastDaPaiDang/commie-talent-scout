import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
const remote=process.argv.includes('--remote'),base=remote?'https://scout-staging.dapaidang.org':'http://127.0.0.1:8790';
assert.equal((await fetch(base+'/api/health',{headers:{Connection:'close'}}).then(r=>r.json())).environment,'staging');
const admin=JSON.parse(readFileSync(`secrets/bootstrap-staging-${remote?'remote':'local'}-admin.json`,'utf8'));
const suffix=randomUUID().slice(0,8),checks=[],fixtures=[],clients=[];
const secret=()=>randomBytes(24).toString('base64url');
const privateFile=`secrets/member-concurrency-${remote?'remote':'local'}-${suffix}.json`;
mkdirSync('secrets',{recursive:true});mkdirSync('tmp/verification',{recursive:true});
const save=()=>writeFileSync(privateFile,JSON.stringify({fixtures:fixtures.map(({client,...fixture})=>fixture)},null,2),{mode:0o600});
async function http(path,body,cookie){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Connection:'close',...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{Origin:base,'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function connect(token){const c=new Client({name:'cts-member-race',version:'0.1.0'});await c.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token,Connection:'close'}}}));clients.push(c);return c;}
async function call(c,name,args={}){return c.callTool({name,arguments:args});}
function ok(r){assert.ok(!r.isError,'MCP command succeeds: '+(r.structuredContent?.error?.code??''));return r.structuredContent;}
function sql(command){writeFileSync('tmp/verification/member-recovery.sql',command);const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cts-staging','--env','staging',remote?'--remote':'--local','--file','tmp/verification/member-recovery.sql','--json'],{encoding:'utf8'});assert.equal(r.status,0,'private staging recovery succeeds');}
const initial=await http('/auth/login',{username:admin.username,password:admin.password});assert.equal(initial.status,200);
const rootId=initial.body.member.id;
const rootConnection=(await http('/connections',{name:'管理员并发验收 '+suffix,days:1},initial.cookie)).body;
const root=await connect(rootConnection.secret);
let raceStarted=false,restored=false;
try{
  for(const name of ['A','B']){
    const f={username:`race-${name.toLowerCase()}-${suffix}`,temporary_password:secret(),password:secret()};fixtures.push(f);save();
    const created=ok(await call(root,'create_member',{username:f.username,name:'虚构并发管理员 '+name,role:'admin',temporary_password:f.temporary_password,request_id:randomUUID()}));
    assert.ok(!JSON.stringify(created).includes(f.temporary_password));f.id=created.id;save();
    const first=await http('/auth/login',{username:f.username,password:f.temporary_password});assert.equal(first.status,200);
    assert.equal((await http('/auth/password',{current_password:f.temporary_password,new_password:f.password},first.cookie)).status,200);
    const ready=await http('/auth/login',{username:f.username,password:f.password});assert.equal(ready.status,200);f.cookie=ready.cookie;
    f.connection=(await http('/connections',{name:'并发管理员 '+name,days:1},ready.cookie)).body;save();
    f.client=await connect(f.connection.secret);
  }
  checks.push('MCP-created administrators can complete their private first-password setup');
  const before=ok(await call(root,'get_member_history',{id:rootId})).events.length;
  const current=ok(await call(root,'whoami')).member;
  const noop=ok(await call(root,'set_member_role',{id:rootId,expected_version:current.version,role:'admin',request_id:randomUUID()}));assert.equal(noop.changed,false);
  assert.equal(ok(await call(root,'get_member_history',{id:rootId})).events.length,before);
  checks.push('saving unchanged access leaves version and management history unchanged');
  const members=ok(await call(root,'list_members',{limit:100})).members;
  const ids=new Set([rootId,...fixtures.map(x=>x.id)]);
  assert.deepEqual(new Set(members.filter(x=>x.role==='admin'&&!x.frozen).map(x=>x.id)),ids,'only the three controlled administrators participate');
  const actors=[{id:rootId,client:root},...fixtures];
  raceStarted=true;
  const results=await Promise.all(actors.map(a=>call(a.client,'set_member_role',{id:a.id,expected_version:members.find(x=>x.id===a.id).version,role:'member',request_id:randomUUID()})));
  assert.equal(results.filter(x=>!x.isError).length,2,'only two self-demotions may commit');
  assert.equal(results.filter(x=>x.isError&&x.structuredContent.error.code==='LAST_ADMIN_REQUIRED').length,1,'the last administrator is protected inside the transaction');
  const identities=await Promise.all(actors.map(async a=>({...a,identity:ok(await call(a.client,'whoami')).member})));
  const winners=identities.filter(a=>a.identity.role==='admin');assert.equal(winners.length,1);
  const winner=winners[0],loser=identities.find(a=>a.identity.role==='member');
  const denied=await call(loser.client,'set_member_role',{id:loser.id,expected_version:loser.identity.version,role:'admin',request_id:randomUUID()});assert.ok(denied.isError);assert.equal(denied.structuredContent.error.code,'ADMIN_REQUIRED');
  checks.push('concurrent self-demotions leave exactly one active administrator and old loser credentials immediately lose admin authority');
  const rootNow=ok(await call(winner.client,'list_members',{limit:100})).members.find(x=>x.id===rootId);
  if(rootNow.role!=='admin')ok(await call(winner.client,'set_member_role',{id:rootId,expected_version:rootNow.version,role:'admin',request_id:randomUUID()}));
  assert.equal(ok(await call(root,'whoami')).member.role,'admin');restored=true;
  const history=ok(await call(root,'get_member_history',{id:fixtures[0].id}));assert.ok(history.events.some(x=>x.kind==='member.created'&&x.source==='mcp'));assert.ok(!JSON.stringify(history).includes(fixtures[0].temporary_password));
  const calls=(await http('/admin/calls?limit=100',undefined,initial.cookie)).body.calls.filter(x=>x.credential_id===rootConnection.id&&x.tool==='create_member');
  assert.equal(calls.length,2);
  for(const item of calls){const detail=(await http('/admin/calls/'+item.id,undefined,initial.cookie)).body;assert.ok(!JSON.stringify(detail).includes('temporary_password'));assert.ok(!JSON.stringify(detail).includes('scrypt$'));}
  checks.push('management audit and administrator call review retain attribution and omit passwords and hashes');
}finally{
  if(raceStarted&&!restored)sql(`UPDATE members SET role='admin',frozen=0,auth_epoch=auth_epoch+1,version=version+1 WHERE id='${rootId}';`);
  if(restored||!raceStarted){
    for(const f of fixtures){if(!f.id)continue;try{const row=ok(await call(root,'list_members',{limit:100})).members.find(x=>x.id===f.id);if(row&&!row.frozen)ok(await call(root,'set_member_frozen',{id:f.id,expected_version:row.version,frozen:true,request_id:randomUUID()}));}catch{/* Management recovery below freezes only this run's synthetic fixtures. */}}
  }
  // Keep the synthetic member identities/audit for traceability, while disabling their credentials.
  for(const f of fixtures)if(f.id)sql(`UPDATE members SET frozen=1,auth_epoch=auth_epoch+CASE WHEN frozen=0 THEN 1 ELSE 0 END,version=version+CASE WHEN frozen=0 THEN 1 ELSE 0 END WHERE id='${f.id}';`);
  for(const c of clients)await c.close().catch(()=>{});
  await http('/connections/revoke',{id:rootConnection.id},initial.cookie).catch(()=>{});await http('/auth/logout',{},initial.cookie).catch(()=>{});
  writeFileSync(`tmp/verification/member-concurrency-${remote?'cloud':'local'}.json`,JSON.stringify({date:new Date().toISOString(),base,checks},null,2));
}
console.log(JSON.stringify({base,passed:checks.length}));
