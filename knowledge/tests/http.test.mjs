import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,request} from './fixture.mjs';
import {fixture as personnelFixture} from '../../tests/d1-fixture.mjs';
import worker from '../src/index.ts';
import personnel from '../../app/server/index.ts';
import {digest} from '../../app/server/types.ts';

async function connected(t){
 const k=fixture(),p=personnelFixture();t.after(k.close);t.after(p.close);const at=new Date().toISOString(),token='test-only-knowledge-bridge';p.env.ENVIRONMENT='staging';
 p.sqlite.prepare('UPDATE credentials SET hash=? WHERE id=?').run(await digest(token),p.actor.credential_id);
 const membership=request();p.sqlite.prepare("INSERT INTO archives(id,type,name,status,person_role,linked_account_id,created_by,created_at,updated_at) VALUES(?,'person',?,'已入伙','member',?,?,?,?)").run(membership,p.actor.name,p.actor.id,p.actor.id,at,at);
 const paths=[],pending=[],ctx={waitUntil(p){pending.push(p);}};t.after(()=>Promise.all(pending));
 const env={KNOWLEDGE_DB:k.db,ENVIRONMENT:'staging',APP_ORIGIN:'https://knowledge.example',IDENTITY_ORIGIN:'https://identity.example',IDENTITY:{fetch(req){assert.equal(req.redirect,'manual','workerd supports manual; credentials must never follow redirects');paths.push(new URL(req.url).pathname);return personnel.fetch(req,p.env,ctx);}}};
 const call=async(path,body,headers={Authorization:'Bearer '+token})=>{const response=await worker.fetch(new Request(env.APP_ORIGIN+path,{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);return {status:response.status,headers:response.headers,body:await response.json()};};
 return {k,p,env,ctx,call,paths,token,membership};
}
test('HTTP uses separate D1; main identity checks current binding, freezing and credentials without exporting private data',async t=>{
 const f=await connected(t);assert.equal((await f.call('/api/entries',undefined,{})).status,401);const who=await f.call('/api/identity');assert.equal(who.body.eligible,true);assert.equal(who.body.membership_id,f.membership);assert.equal(who.body.qq,undefined);assert.equal(who.body.credential_id,undefined);
 const created=await f.call('/api/drafts',{title:'独立存储',body:'正文',tags:['共识'],request_id:request()});assert.equal(created.status,200);assert.equal(f.k.sqlite.prepare('SELECT count(*) n FROM kb_entries').get().n,1);assert.equal(f.p.sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE name='kb_entries'").get().n,0);
 f.p.sqlite.prepare("UPDATE archives SET person_role='external' WHERE id=?").run(f.membership);assert.equal((await f.call('/api/identity')).body.eligible,false);
 f.p.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.p.actor.id);assert.equal((await f.call('/api/entries')).status,401);f.p.sqlite.prepare('UPDATE members SET frozen=0 WHERE id=?').run(f.p.actor.id);
 f.p.sqlite.prepare('UPDATE credentials SET revoked_at=? WHERE id=?').run(new Date().toISOString(),f.p.actor.credential_id);assert.equal((await f.call('/api/identity')).status,401);assert.ok(f.paths.every(p=>p==='/api/knowledge/identity'));
});
test('HTTPS, cross-origin, unavailable identity and cross-environment protections fail closed',async t=>{
 const f=await connected(t);const plain=await worker.fetch(new Request('http://knowledge.example/api/entries',{headers:{Authorization:'Bearer '+f.token}}),f.env,f.ctx);assert.equal(plain.status,403);assert.equal(f.paths.length,0);
 assert.equal((await f.call('/api/entries',undefined,{Authorization:'Bearer '+f.token,Origin:'https://other.example'})).status,403);
 f.env.ENVIRONMENT='production';assert.equal((await f.call('/api/identity')).status,503);f.env.ENVIRONMENT='staging';
 f.env.IDENTITY={fetch(){return new Response(null,{status:302,headers:{Location:'https://unrelated.example'}});}};assert.equal((await f.call('/api/identity')).status,503);
 f.env.IDENTITY={fetch(){throw new Error('unavailable');}};assert.equal((await f.call('/api/entries')).status,503);assert.equal(f.k.sqlite.prepare('SELECT count(*) n FROM kb_entries').get().n,0);
});
test('MCP initializes, discovers tools, isolates drafts, returns effective text and uses the HTTP domain service',async t=>{
 const f=await connected(t);const headers={Host:'knowledge.example',Authorization:'Bearer '+f.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
 const rpc=async(method,params)=>{const r=await worker.fetch(new Request(f.env.APP_ORIGIN+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),f.env,f.ctx);const s=await r.text();assert.equal(r.status,200,s);return JSON.parse(s.startsWith('{')?s:s.split('\n').find(l=>l.startsWith('data:')).slice(5)).result;};
 const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'knowledge-test',version:'1'}});assert.equal(init.serverInfo.name,'commie-knowledge');headers['MCP-Protocol-Version']=init.protocolVersion;
 const names=(await rpc('tools/list',{})).tools.map(t=>t.name);assert.ok(names.includes('knowledge_effective'));assert.ok(!names.includes('confirm_membership'));
 const data={title:'MCP 草稿',body:'通过同一服务保存',tags:['方法'],request_id:request()};const result=await rpc('tools/call',{name:'knowledge_save_draft',arguments:data});assert.equal(result.isError,undefined);const draft=result.structuredContent;
 const read=await f.call('/api/entries/'+draft.entry_id);assert.equal(read.body.versions[0].body,data.body);assert.equal(read.body.versions[0].url,f.env.APP_ORIGIN+'/api/entries/'+draft.entry_id);assert.equal((await rpc('tools/call',{name:'knowledge_effective',arguments:{}})).structuredContent.entries.length,0);
 const pub=await rpc('tools/call',{name:'knowledge_submit',arguments:{id:draft.id,expected_revision:1,request_id:request()}});const vote=await rpc('tools/call',{name:'knowledge_endorse',arguments:{proposal_id:pub.structuredContent.proposal_id,request_id:request()}});assert.equal(vote.structuredContent.votes,1);assert.equal((await f.call('/api/entries/'+draft.entry_id)).body.votes.length,1);
});
