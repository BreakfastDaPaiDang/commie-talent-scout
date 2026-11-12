import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from './fixture.mjs';
import {connectedFixture} from './connected-fixture.mjs';
import worker from '../src/index.ts';
import personnel from '../../app/server/index.ts';
import {emptyCatalogContent} from '../../app/shared/catalog.ts';

async function connected(t){const f=await connectedFixture();t.after(f.close);return f;}
const entry=f=>({id:request(),request_id:request(),record_kind:'resource',content:{...emptyCatalogContent(),name:'独立资源',owner_id:f.p.actor.id,note:'正式发布说明'}});
test('HTTP uses separate D1, checks live formal membership and retires the old voting writes',async t=>{
 const f=await connected(t);assert.equal((await f.call('/api/catalog/entries',undefined,{})).status,401);const who=await f.call('/api/identity');assert.equal(who.body.eligible,true);assert.equal(who.body.membership_id,f.membership);assert.equal(who.body.qq,undefined);assert.equal(who.body.credential_id,undefined);
 assert.equal((await f.call('/api/drafts',{title:'旧流程',body:'正文',tags:['共识'],request_id:request()})).status,410);
 const p=entry(f),created=await f.call('/api/catalog/entries',p);assert.equal(created.status,200,JSON.stringify(created.body));assert.equal(f.k.sqlite.prepare('SELECT count(*) n FROM catalog_entries').get().n,1);assert.equal(f.p.sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE name='catalog_entries'").get().n,0);
 f.p.sqlite.prepare("UPDATE archives SET person_role='external' WHERE id=?").run(f.membership);assert.equal((await f.call('/api/catalog/entries')).status,403);
 f.p.sqlite.prepare('UPDATE members SET frozen=1 WHERE id=?').run(f.p.actor.id);assert.equal((await f.call('/api/catalog/entries')).status,401);f.p.sqlite.prepare('UPDATE members SET frozen=0 WHERE id=?').run(f.p.actor.id);
 f.p.sqlite.prepare('UPDATE credentials SET revoked_at=? WHERE id=?').run(new Date().toISOString(),f.p.actor.credential_id);assert.equal((await f.call('/api/identity')).status,401);assert.ok(f.paths.every(p=>['/api/knowledge/identity','/api/knowledge/members'].includes(p)));
});
test('HTTPS, cross-origin, unavailable identity and cross-environment protections fail closed',async t=>{
 const f=await connected(t);const plain=await worker.fetch(new Request('http://knowledge.example/api/catalog/entries',{headers:{Authorization:'Bearer '+f.token}}),f.env,f.ctx);assert.equal(plain.status,403);assert.equal(f.paths.length,0);
 assert.equal((await f.call('/api/catalog/entries',undefined,{Authorization:'Bearer '+f.token,Origin:'https://other.example'})).status,403);
 f.env.ENVIRONMENT='production';assert.equal((await f.call('/api/identity')).status,503);f.env.ENVIRONMENT='staging';
 f.env.IDENTITY={fetch(){return new Response(null,{status:302,headers:{Location:'https://unrelated.example'}});}};assert.equal((await f.call('/api/identity')).status,503);
 f.env.IDENTITY={fetch(){throw new Error('unavailable');}};assert.equal((await f.call('/api/catalog/entries')).status,503);assert.equal(f.k.sqlite.prepare('SELECT count(*) n FROM catalog_entries').get().n,0);
});
test('MCP and HTTP publish and resolve the same versioned issue; retired voting tools are absent',async t=>{
 const f=await connected(t),headers={Host:'knowledge.example',Authorization:'Bearer '+f.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
 const rpc=async(method,params)=>{const r=await worker.fetch(new Request(f.env.APP_ORIGIN+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),f.env,f.ctx),s=await r.text();assert.equal(r.status,200,s);return JSON.parse(s.startsWith('{')?s:s.split('\n').find(l=>l.startsWith('data:')).slice(5)).result;};
 const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'catalog-test',version:'1'}});assert.equal(init.serverInfo.name,'commie-knowledge');headers['MCP-Protocol-Version']=init.protocolVersion;
 const names=(await rpc('tools/list',{})).tools.map(t=>t.name);assert.ok(names.includes('catalog_publish'));assert.ok(!names.includes('knowledge_endorse'));assert.ok(!names.includes('confirm_membership'));
 const p=entry(f),created=await rpc('tools/call',{name:'catalog_publish',arguments:p});assert.equal(created.isError,undefined,JSON.stringify(created));assert.equal((await f.call('/api/catalog/entries/'+p.id)).body.entry.note,p.content.note);
 const proposed=await rpc('tools/call',{name:'catalog_submit_issue',arguments:{id:request(),request_id:request(),target_type:'entry',target_id:p.id,base_version:1,title:'补充入口',body:'提供方确认',proposal:{...p.content,contact:'联系负责人'}}});assert.equal(proposed.isError,undefined,JSON.stringify(proposed));
 const resolved=await f.call('/api/catalog/issues/resolve',{request_id:request(),issue_id:proposed.structuredContent.id,expected_version:1,action:'merge',result:'已核对'});assert.equal(resolved.status,200);assert.equal((await f.call('/api/catalog/entries/'+p.id)).body.entry.contact,'联系负责人');
});
test('main-site cookie proxy crosses only the fixed binding and grants do not unlock main personnel APIs',async t=>{
 const f=await connected(t),origin='https://identity.example',headers={Cookie:'cts_session='+f.session,Origin:origin,'Content-Type':'application/json'},p=entry(f);
 const post=await personnel.fetch(new Request(origin+'/api/catalog/entries',{method:'POST',headers,body:JSON.stringify(p)}),f.p.env,f.ctx);assert.equal(post.status,200,await post.text());
 const list=await personnel.fetch(new Request(origin+'/api/resources',{headers}),f.p.env,f.ctx);assert.equal(list.status,200);assert.equal((await list.json()).resources[0].id,p.id);
 const gift=await f.call('/api/catalog/grants',{id:request(),request_id:request(),entry_id:p.id,recipient_name:'测试接收者',receiver_id:f.p.actor.id});assert.equal(gift.status,200);const key=gift.body.access_key;
 const session=await personnel.fetch(new Request(origin+'/api/catalog/access/session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({key})}),f.p.env,f.ctx);assert.equal(session.status,200);assert.match(session.headers.get('Set-Cookie'),/HttpOnly/);
 const giftHeaders={Cookie:'cts_candy='+key};assert.equal((await personnel.fetch(new Request(origin+'/api/catalog/entries',{headers:giftHeaders}),f.p.env,f.ctx)).status,200);assert.equal((await personnel.fetch(new Request(origin+'/api/archives',{headers:giftHeaders}),f.p.env,f.ctx)).status,401);
 assert.equal((await personnel.fetch(new Request(origin+'/api/catalog/entries',{method:'POST',headers:{...giftHeaders,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(entry(f))}),f.p.env,f.ctx)).status,403);
});
