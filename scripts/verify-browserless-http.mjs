import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('browserless-http',{environment:process.argv.includes('--production')?'production':'staging'}),checks=[];let credential,archive;
// Keep urllib's default Python User-Agent: changing it would hide edge rejection.
const source=`import sys,json,urllib.request,urllib.error,base64
a=json.load(sys.stdin)
req=urllib.request.Request(a['url'],data=base64.b64decode(a['body']),method=a['method'],headers=a['headers'])
try:
 r=urllib.request.urlopen(req,timeout=30); body=r.read().decode(errors='replace'); print(json.dumps({'status':r.status,'cloudflare_1010':'error code: 1010' in body,'body':body}))
except urllib.error.HTTPError as e:
 body=e.read().decode(errors='replace'); print(json.dumps({'status':e.code,'cloudflare_1010':'error code: 1010' in body,'body':body}))
`;
function request(url,method,headers,body){const r=spawnSync('python',['-c',source],{input:JSON.stringify({url,method,headers,body:Buffer.from(body).toString('base64')}),encoding:'utf8',windowsHide:true});assert.equal(r.status,0,'Python HTTP process completed');const result=JSON.parse(r.stdout);assert.equal(result.cloudflare_1010,false,'Cloudflare must not reject machine clients by browser signature');return result;}
try{
 credential=(await v.http('/connections',{name:'开发验收：Python HTTP',days:1})).body;
 const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'browserless-http-check',version:'1.0'}}}),headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
 assert.equal(request(v.base+'/mcp','POST',headers,body).status,401);
 assert.equal(request(v.base+'/mcp','POST',{...headers,Authorization:'Bearer '+credential.secret},body).status,200);
 checks.push('default Python urllib MCP: valid credential 200; anonymous request 401 from application');
 archive=await v.call('create_archive',{type:'person',name:'虚构无浏览器上传 '+randomUUID().slice(0,8),request_id:randomUUID()});
 const png=readFileSync(new URL('../tests/fixtures/images/shapes.png',import.meta.url)),ticket=await v.call('prepare_image_upload',{purpose:'observation',archive_id:archive.id,mime_type:'image/png',byte_size:png.length,sha256:createHash('sha256').update(png).digest('hex')});
 assert.equal(request(ticket.url,'PUT',{'Content-Type':'image/png'},png).status,401);
 const upload=request(ticket.url,'PUT',ticket.headers,png);assert.equal(upload.status,200);assert.equal(JSON.parse(upload.body).state,'ready');
 const observation=await v.call('create_observation',{archive_id:archive.id,body:'虚构 Python 上传验证',attachment_ids:[ticket.attachment_id],request_id:randomUUID()});assert.ok(observation.id);
 checks.push('default Python urllib uploads: missing ticket 401; signed PUT 200 and resulting image publishes');
 await v.http('/connections/revoke',{id:credential.id});assert.equal(request(v.base+'/mcp','POST',{...headers,Authorization:'Bearer '+credential.secret},body).status,401);
 checks.push('revocation immediately rejects the same Python MCP credential');
}finally{
 if(archive){const a=(await v.call('get_archive',{id:archive.id})).archive;if(!a.closed)await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:randomUUID()});}
 if(credential)await v.http('/connections/revoke',{id:credential.id});await v.close(checks);
}
