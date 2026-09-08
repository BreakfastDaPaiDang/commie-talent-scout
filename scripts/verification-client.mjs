import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {setDefaultResultOrder} from 'node:dns';
import {setDefaultAutoSelectFamily} from 'node:net';
// This verification host advertises IPv6 DNS records but cannot reliably connect over IPv6.
setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);
export async function verificationClient(name){
 const remote=process.argv.includes('--remote'),target=remote?'cloud':'local',base=remote?'https://scout-staging.dapaidang.org':'http://127.0.0.1:8790';
 assert.equal((await fetch(base+'/api/health',{headers:{Connection:'close'}}).then(r=>r.json())).environment,'staging');
 const admin=JSON.parse(readFileSync(`secrets/bootstrap-staging-${remote?'remote':'local'}-admin.json`));let cookie;const recoveries=[];
 async function http(path,body){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Connection:'close',Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const login=await http('/auth/login',{username:admin.username,password:admin.password});assert.equal(login.status,200);cookie=login.cookie;
 const connection=await http('/connections',{name:'验收 '+name,days:1});assert.equal(connection.status,200);
 const client=new Client({name:'cts-verify-'+name,version:'0.1.0'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+connection.body.secret,Connection:'close'}}}));
 return {base,target,get sessionCookie(){return cookie;},actor:login.body.member,http,client,async call(tool,args={}){let r;try{r=await client.callTool({name:tool,arguments:args});}catch(error){if(error.code!=='REQUEST_TIMEOUT'||!args.request_id)throw error;const receipt=await http('/commands/'+args.request_id);if(receipt.status!==200||receipt.body.status!=='completed')throw error;recoveries.push({tool,via:'committed_receipt_after_transport_timeout'});return receipt.body.result;}assert.ok(!r.isError,r.structuredContent?.error?.code);return r.structuredContent;},async close(checks){await client.close();await http('/connections/revoke',{id:connection.body.id});await http('/auth/logout',{});mkdirSync('tmp/verification',{recursive:true});writeFileSync(`tmp/verification/${name}-${target}.json`,JSON.stringify({date:new Date().toISOString(),base,checks,recoveries},null,2));console.log(JSON.stringify({name,target,passed:checks.length}));}};
}
