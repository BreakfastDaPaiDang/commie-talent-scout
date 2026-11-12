import test from 'node:test';
import assert from 'node:assert/strict';
import {connectedFixture} from './connected-fixture.mjs';
import {request} from './fixture.mjs';
import personnel from '../../app/server/index.ts';

test('workspace crosses the fixed main-site cookie bridge and stores comments only in independent D1',async()=>{const f=await connectedFixture();try{
 const origin='https://identity.example',headers={Cookie:'cts_session='+f.session,Origin:origin,'Content-Type':'application/json'};
 const call=async(path,body)=>{const r=await personnel.fetch(new Request(origin+'/api/knowledge-workspace'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify({...body,request_id:request()}):undefined}),f.p.env,f.ctx);return {status:r.status,data:await r.json()};};
 const b=await call('/branches',{name:'网页分支'});assert.equal(b.status,200,JSON.stringify(b));const doc=await call('/documents',{branch_id:b.data.id,expected_version:1,title:'接口验证',body:'这是第一句。\n这是第二句。',category:'自建分类',message:'创建'});assert.equal(doc.status,200,JSON.stringify(doc));
 const post=await call('/comments',{branch_id:b.data.id,document_id:doc.data.id,body:'这是文末评论'});assert.equal(post.status,200,JSON.stringify(post));assert.equal(f.k.sqlite.prepare('SELECT COUNT(*) n FROM kw_comments').get().n,1);assert.equal(f.p.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='kw_comments'").get().n,0);
 const cross=await personnel.fetch(new Request(origin+'/api/knowledge-workspace/comments',{method:'POST',headers:{...headers,Origin:'https://other.example'},body:JSON.stringify({branch_id:b.data.id,document_id:doc.data.id,body:'越权来源',request_id:request()})}),f.p.env,f.ctx);assert.equal(cross.status,403);
 f.p.sqlite.prepare('UPDATE archives SET closed=1 WHERE id=?').run(f.membership);assert.equal((await call('/branches')).status,403);
}finally{await f.close();}});

test('main MCP discovers and invokes the same workspace service without gaining vote or membership powers',async()=>{const f=await connectedFixture();try{
 const headers={Authorization:'Bearer '+f.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',Host:'identity.example'},rpc=async(method,params)=>{const r=await personnel.fetch(new Request('https://identity.example/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),f.p.env,f.ctx);const body=await r.text();assert.equal(r.status,200,body);return JSON.parse(body.startsWith('{')?body:body.split('\n').find(l=>l.startsWith('data:')).slice(5)).result;};
 const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'workspace-test',version:'1'}});headers['MCP-Protocol-Version']=init.protocolVersion;
 const list=await rpc('tools/list',{});assert.ok(list.tools.some(t=>t.name==='knowledge_create_branch'));const branch=await rpc('tools/call',{name:'knowledge_create_branch',arguments:{name:'MCP 知识修改',request_id:request()}});assert.ok(!branch.isError,JSON.stringify(branch));const stored=await f.call('/api/knowledge-workspace/branches');assert.ok(stored.body.branches.some(b=>b.id===branch.structuredContent.id));
 const main=await f.call('/api/knowledge-workspace/documents');assert.equal(main.body.documents.length,0);
}finally{await f.close();}});
