import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../app/server/index.ts';
import {fixture} from './d1-fixture.mjs';
import {digest} from '../app/server/types.ts';

const rpcBody={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'whoami',arguments:{}}};
test('production rejects plaintext MCP before credentials, journal, or business access, without redirecting',async()=>{
 let touched=false;
 const env={ENVIRONMENT:'production',DB:{prepare(){touched=true;throw new Error('must not access DB');}}};
 for(const method of ['POST','GET','DELETE']){
  const response=await worker.fetch(new Request('http://scout.dapaidang.org/mcp',{method,headers:{Authorization:'Bearer fixture-secret','X-Forwarded-Proto':'https','Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(rpcBody)}:{})}),env,{waitUntil(){}});
  assert.equal(response.status,403);assert.equal(response.headers.get('Location'),null);
  assert.match(response.headers.get('Cache-Control'),/no-store/);
  const text=await response.text();assert.equal(JSON.parse(text).error.code,'HTTPS_REQUIRED');assert.ok(!text.includes('fixture-secret'));
 }
 assert.equal(touched,false);
});

for(const [environment,origin] of [['production','https://scout.dapaidang.org'],['staging','http://127.0.0.1:8790']]){
 test(environment+' permits authenticated MCP initialize and whoami over its supported transport',async t=>{
  const f=fixture();t.after(f.close);const token='fixture-only';f.env.ENVIRONMENT=environment;
  f.sqlite.prepare('UPDATE credentials SET hash=? WHERE id=?').run(await digest(token),f.actor.credential_id);
  const pending=[],ctx={waitUntil(p){pending.push(p);}};
  const headers={Host:new URL(origin).host,Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
  async function rpc(body){
   const r=await worker.fetch(new Request(origin+'/mcp',{method:'POST',headers,body:JSON.stringify(body)}),f.env,ctx);
   const text=await r.text();assert.equal(r.status,200,text);
   return JSON.parse(text.startsWith('{')?text:text.split('\n').find(l=>l.startsWith('data:')).slice(5));
  }
  const init=await rpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}});
  assert.equal(init.result.serverInfo.name,'commie-talent-scout');headers['MCP-Protocol-Version']=init.result.protocolVersion;
  const identity=await rpc({...rpcBody,id:2});
  assert.equal(identity.result.structuredContent.member.id,f.actor.id);
  assert.equal(identity.result.structuredContent.origin,origin);
  await Promise.all(pending);
 });
}

