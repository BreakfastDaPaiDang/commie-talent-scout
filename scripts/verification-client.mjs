import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {setDefaultResultOrder} from 'node:dns';
import {setDefaultAutoSelectFamily} from 'node:net';
// This verification host advertises IPv6 DNS records but cannot reliably connect over IPv6.
setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);
export async function verificationClient(name,{environment='staging'}={}){
 assert.ok(['staging','production'].includes(environment));const production=environment==='production';if(production)assert.ok(process.argv.includes('--production'),'production verification must be explicitly selected');
 const remote=production||process.argv.includes('--remote'),target=production?'production':remote?'cloud':'local',base=production?'https://scout.dapaidang.org':remote?'https://scout-staging.dapaidang.org':'http://127.0.0.1:8790';
 assert.equal((await fetch(base+'/api/health',{headers:{Connection:'close'}}).then(r=>r.json())).environment,environment);
 const admin=JSON.parse(readFileSync(production?'secrets/development-test-admin.json':`secrets/bootstrap-staging-${remote?'remote':'local'}-admin.json`));let cookie;const recoveries=[],catalogCreated=[];
 async function http(path,body,{bearer=false}={}){const r=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Connection:'close',Origin:base,'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+connection.body.secret}:cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const login=await http('/auth/login',{username:admin.username,password:admin.password});assert.equal(login.status,200);cookie=login.cookie;
 const connection=await http('/connections',{name:'验收 '+name,days:1});assert.equal(connection.status,200);
 const client=new Client({name:'cts-verify-'+name,version:'0.1.0'});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+connection.body.secret,Connection:'close'}}}));
 async function call(tool,args={}){
  let result;
  try{const r=await client.callTool({name:tool,arguments:args});assert.ok(!r.isError,r.structuredContent?.error?.code);result=r.structuredContent;}
  catch(error){if(error.code!=='REQUEST_TIMEOUT'||!args.request_id)throw error;const receipt=await http('/commands/'+args.request_id,undefined,{bearer:true});if(receipt.status!==200||receipt.body.status!=='completed')throw error;recoveries.push({tool,via:'committed_receipt_after_transport_timeout'});result=receipt.body.result;}
  if((tool==='create_tag_category'||tool==='create_tag')&&result.changed&&!result.reused)catalogCreated.push({entity_type:tool==='create_tag'?'tag':'category',id:result.id});
  return result;
 }
 return {base,target,get sessionCookie(){return cookie;},actor:login.body.member,http,client,call,async close(checks){
  const cleanupErrors=[];
  try{for(const subject of [...catalogCreated].reverse()){
   try{const preview=await http('/tag-deletion/preview',{...subject,deleted:true,reason:'验收结束，清理本次创建的虚构词库内容'},{bearer:true});assert.equal(preview.status,200);if(preview.body.changed){const saved=await http('/tag-deletion/apply',{preview_id:preview.body.preview_id,request_id:crypto.randomUUID()},{bearer:true});assert.equal(saved.status,200);}}
   catch(error){cleanupErrors.push({entity_type:subject.entity_type,id:subject.id,message:String(error)});}
  }}finally{try{await client.close();}finally{try{const revoked=await http('/connections/revoke',{id:connection.body.id},{bearer:true});assert.equal(revoked.status,200,'verification connection must be revoked');}finally{await http('/auth/logout',{});}}}
  mkdirSync('tmp/verification',{recursive:true});writeFileSync(`tmp/verification/${name}-${target}.json`,JSON.stringify({date:new Date().toISOString(),base,checks,recoveries,catalog_cleanup:{created:catalogCreated.length,errors:cleanupErrors}},null,2));
  assert.equal(cleanupErrors.length,0,'verification-created vocabulary must be cleaned up');console.log(JSON.stringify({name,target,passed:checks.length,catalog_cleaned:catalogCreated.length}));
 }};
}
