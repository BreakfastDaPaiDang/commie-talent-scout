import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
export async function verificationClient(name){
 const remote=process.argv.includes('--remote'),target=remote?'cloud':'local',base=remote?'https://scout-staging.dapaidang.org':'http://127.0.0.1:8790';
 assert.equal((await fetch(base+'/api/health',{headers:{Connection:'close'}}).then(r=>r.json())).environment,'staging');
 const admin=JSON.parse(readFileSync(`secrets/bootstrap-staging-${remote?'remote':'local'}-admin.json`));let cookie;
 async function http(path,body){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Connection:'close',Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const login=await http('/auth/login',{username:admin.username,password:admin.password});assert.equal(login.status,200);cookie=login.cookie;
 const connection=await http('/connections',{name:'验收 '+name,days:1});assert.equal(connection.status,200);
 const client=new Client({name:'cts-verify-'+name,version:'0.1.0'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+connection.body.secret,Connection:'close'}}}));
 return {base,target,actor:login.body.member,http,client,async call(tool,args={}){const r=await client.callTool({name:tool,arguments:args});assert.ok(!r.isError,r.structuredContent?.error?.code);return r.structuredContent;},async close(checks){await client.close();await http('/connections/revoke',{id:connection.body.id});await http('/auth/logout',{});mkdirSync('tmp/verification',{recursive:true});writeFileSync(`tmp/verification/${name}-${target}.json`,JSON.stringify({date:new Date().toISOString(),base,checks},null,2));console.log(JSON.stringify({name,target,passed:checks.length}));}};
}
