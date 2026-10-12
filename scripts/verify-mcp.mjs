import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {verificationClient} from './verification-client.mjs';

const v=await verificationClient('mcp'),checks=[];let connection,client,member,memberCookie;
const ok=r=>{assert.equal(r.status,200);return r.body;};
const memberRequest=async(path,body)=>{
 const r=await fetch(v.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:v.base,'Content-Type':'application/json',...(memberCookie?{Cookie:memberCookie}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 if(r.headers.get('set-cookie'))memberCookie=r.headers.get('set-cookie').split(';')[0];
 return {status:r.status,body:await r.json()};
};
try{
 assert.equal((await fetch(v.base+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 connection=ok(await v.http('/connections',{name:'MCP 协议与撤销验收',days:1}));
 const listing=ok(await v.http('/connections'));assert.ok(!JSON.stringify(listing).includes(connection.secret));assert.ok(listing.credentials.every(c=>!('hash' in c)&&!('secret' in c)));
 client=new Client({name:'cts-mcp-contract',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(v.base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+connection.secret}}}));
 const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,name);return r.structuredContent;};
 const who=await call('whoami'),catalog=await client.listTools();assert.equal(who.member.id,v.actor.id);assert.equal(who.member.execution_purpose,'verification');
 assert.deepEqual([...who.capabilities].sort(),catalog.tools.map(t=>t.name).sort());
 for(const tool of catalog.tools){assert.ok(tool.outputSchema,tool.name);assert.ok(tool.annotations&&tool.description,tool.name);}
 for(const topic of who.guide_topics){const guide=await call('get_usage_guide',{topic});assert.equal(guide.topic,topic);assert.ok(guide.rules.length);assert.deepEqual(guide.available_topics,who.guide_topics);}
 checks.push('cold client: capabilities, output schemas, every guide accessible; secrets omitted from credential lists');
 const invalid=await client.callTool({name:'get_usage_guide',arguments:{topic:'invalid',Authorization:connection.secret,password:'excluded-fixture'}});assert.ok(invalid.isError);
 const calls=ok(await v.http('/admin/calls?limit=100')).calls.filter(c=>c.credential_id===connection.id);
 assert.ok(calls.some(c=>c.tool==='whoami'&&c.outcome==='success'));assert.ok(calls.some(c=>c.tool==='get_usage_guide'&&c.outcome==='rejected'));assert.equal(new Set(calls.map(c=>c.id)).size,calls.length);
 const detail=ok(await v.http('/admin/calls/'+calls.find(c=>c.outcome==='rejected').id));assert.ok(!JSON.stringify(detail).includes(connection.secret));assert.ok(!JSON.stringify(detail).includes('excluded-fixture'));
 checks.push('invalid parameters and success journaled separately; secrets absent from retained call detail');
 const username='mcp-verify-'+randomUUID().slice(0,8),password='Fixture!'+randomUUID();member=await v.call('create_member',{username,name:'虚构 MCP 权限核对',role:'member',temporary_password:password,request_id:randomUUID()});
 ok(await memberRequest('/auth/login',{username,password}));const next='Fixture!'+randomUUID();ok(await memberRequest('/auth/password',{current_password:password,new_password:next}));ok(await memberRequest('/auth/login',{username,password:next}));
 assert.equal((await memberRequest('/admin/calls')).status,403);assert.equal((await memberRequest('/connections/revoke',{id:connection.id})).status,404);checks.push('ordinary member cannot read administrator calls or revoke service connections');
 assert.equal((await call('revoke_connection',{id:connection.id})).revoked,true);await assert.rejects(()=>call('whoami'));
 assert.ok(ok(await v.http('/admin/calls?limit=100')).calls.some(c=>c.tool==='revoke_connection'&&c.credential_id===connection.id&&c.outcome==='success'));checks.push('revocation blocks connected client and retains successful revocation audit');
}finally{
 try{if(client)await client.close();if(connection)ok(await v.http('/connections/revoke',{id:connection.id}));if(memberCookie)await memberRequest('/auth/logout',{});if(member){const current=(await v.call('get_member',{id:member.id})).member;await v.call('set_member_frozen',{id:member.id,expected_version:current.version,frozen:true,request_id:randomUUID()});}}
 finally{await v.close(checks);}
}
