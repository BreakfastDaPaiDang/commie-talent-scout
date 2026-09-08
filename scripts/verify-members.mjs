import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
const remote=process.argv.includes('--remote'),base=remote?'https://scout-staging.dapaidang.org':'http://127.0.0.1:8790';
assert.equal((await fetch(base+'/api/health',{headers:{Connection:'close'}}).then(r=>r.json())).environment,'staging');
const admin=JSON.parse(readFileSync(`secrets/bootstrap-staging-${remote?'remote':'local'}-admin.json`,'utf8'));
const runId=randomUUID(),password=()=>randomBytes(24).toString('base64url'),checks=[];
async function request(path,body,cookie){
  const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Connection:'close',...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{Origin:base,'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
const login=await request('/auth/login',{username:admin.username,password:admin.password});assert.equal(login.status,200);
const created={username:'verify-'+runId.slice(0,12),name:'虚构验收成员',role:'member',temporary_password:password(),request_id:randomUUID()};
mkdirSync('secrets',{recursive:true});writeFileSync(`secrets/members-${remote?'remote':'local'}-${runId}.json`,JSON.stringify({created},null,2),{mode:0o600});
let memberCookie,connection,client;
try{
  const result=await request('/admin/members/create',created,login.cookie);
  assert.equal(result.status,200,'administrator creates a member through the real HTTP interface');
  assert.ok(!JSON.stringify(result.body).includes(created.temporary_password),'password is not echoed');
  const retry=await request('/admin/members/create',created,login.cookie);assert.equal(retry.status,200);assert.equal(retry.body.id,result.body.id,'identical retry returns the same member');assert.equal(retry.body.replayed,true);
  assert.equal((await request('/admin/members/create',{...created,temporary_password:password()},login.cookie)).status,409,'same request ID cannot silently accept a different password');
  const receipt=await request('/commands/'+created.request_id,undefined,login.cookie);assert.equal(receipt.body.status,'completed');assert.equal(receipt.body.result.id,result.body.id);
  checks.push('creation retry does not duplicate a member and a different temporary password conflicts');
  const first=await request('/auth/login',{username:created.username,password:created.temporary_password});assert.equal(first.status,200);
  assert.equal((await request('/workspace',undefined,first.cookie)).status,403,'temporary password cannot access the workspace');
  const next=password();assert.equal((await request('/auth/password',{current_password:created.temporary_password,new_password:next},first.cookie)).status,200);
  const changed=await request('/auth/login',{username:created.username,password:next});assert.equal(changed.status,200);assert.equal((await request('/workspace',undefined,changed.cookie)).status,200);
  memberCookie=changed.cookie;
  assert.equal((await request('/admin/members',undefined,changed.cookie)).status,403,'ordinary member cannot enter management');
  checks.push('administrator creates a private password record; member must change the temporary password before working');
  connection=(await request('/connections',{name:'成员重置验收',days:1},memberCookie)).body;
  client=new Client({name:'cts-member-verification',version:'0.1.0'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+connection.secret,Connection:'close'}}}));
  assert.equal((await client.callTool({name:'whoami',arguments:{}})).structuredContent.member.id,result.body.id);
  const current=(await request('/admin/members',undefined,login.cookie)).body.members.find(x=>x.id===result.body.id);
  const resetPassword=password();const reset=await request('/admin/members/reset-password',{id:result.body.id,expected_version:current.version,temporary_password:resetPassword,request_id:randomUUID()},login.cookie);
  assert.equal(reset.status,200,'administrator can reset a member password');
  assert.equal((await request('/workspace',undefined,memberCookie)).status,401,'reset invalidates existing web sessions');
  await assert.rejects(()=>client.callTool({name:'whoami',arguments:{}}),'reset invalidates existing MCP credentials');
  const resetLogin=await request('/auth/login',{username:created.username,password:resetPassword});assert.equal(resetLogin.status,200);assert.equal((await request('/workspace',undefined,resetLogin.cookie)).status,403);
  checks.push('password reset immediately invalidates web and MCP credentials and requires a new first-password change');
  const newest=password();assert.equal((await request('/auth/password',{current_password:resetPassword,new_password:newest},resetLogin.cookie)).status,200);
  const ready=await request('/auth/login',{username:created.username,password:newest});assert.equal(ready.status,200);memberCookie=ready.cookie;
  connection=(await request('/connections',{name:'成员冻结验收',days:1},memberCookie)).body;
  const beforeFreeze=(await request('/admin/members',undefined,login.cookie)).body.members.find(x=>x.id===result.body.id);
  const freeze=await request('/admin/members/frozen',{id:result.body.id,expected_version:beforeFreeze.version,frozen:true,request_id:randomUUID()},login.cookie);assert.equal(freeze.status,200,'administrator can freeze a member');
  assert.equal((await request('/workspace',undefined,memberCookie)).status,401);assert.equal((await request('/auth/login',{username:created.username,password:newest})).status,401);
  const thaw=await request('/admin/members/frozen',{id:result.body.id,expected_version:freeze.body.version,frozen:false,request_id:randomUUID()},login.cookie);assert.equal(thaw.status,200);
  assert.equal((await request('/workspace',undefined,memberCookie)).status,401,'unfreezing does not revive old web credentials');
  const invalidMcp=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+connection.secret,'Content-Type':'application/json'},body:'{}'});assert.equal(invalidMcp.status,401,'unfreezing does not revive old MCP credentials');
  checks.push('freeze blocks login and existing credentials, while unfreeze keeps old credentials invalid');
  const self=(await request('/admin/members',undefined,login.cookie)).body.members.find(x=>x.id===login.body.member.id);
  const last=await request('/admin/members/role',{id:self.id,expected_version:self.version,role:'member',request_id:randomUUID()},login.cookie);assert.equal(last.status,409);assert.equal(last.body.error.code,'LAST_ADMIN_REQUIRED');
  checks.push('the last active administrator cannot be demoted');
}finally{
  await client?.close().catch(()=>{});
  if(memberCookie){if(connection?.id)await request('/connections/revoke',{id:connection.id},memberCookie);await request('/auth/logout',{},memberCookie);}
  const fixture=(await request('/admin/members',undefined,login.cookie)).body.members?.find(x=>x.username===created.username);
  if(fixture&&!fixture.frozen)assert.equal((await request('/admin/members/frozen',{id:fixture.id,expected_version:fixture.version,frozen:true,request_id:randomUUID()},login.cookie)).status,200);
  await request('/auth/logout',{},login.cookie);
  mkdirSync('tmp/verification',{recursive:true});writeFileSync(`tmp/verification/members-${remote?'cloud':'local'}.json`,JSON.stringify({date:new Date().toISOString(),base,checks},null,2));
}
console.log(JSON.stringify({base,passed:checks.length}));
