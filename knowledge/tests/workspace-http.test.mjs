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
 const deleted=await call('/branches/delete',{branch_id:b.data.id,expected_version:doc.data.version});assert.equal(deleted.status,200,JSON.stringify(deleted));assert.equal(deleted.data.deleted,true);assert.equal((await call('/branches')).data.branches.some(x=>x.id===b.data.id),false);assert.equal((await call('/documents/'+doc.data.id+'?branch_id='+b.data.id)).status,404);assert.equal((await call('/branches/delete',{branch_id:'main',expected_version:1})).status,403);
 f.p.sqlite.prepare('UPDATE archives SET closed=1 WHERE id=?').run(f.membership);assert.equal((await call('/branches')).status,403);
}finally{await f.close();}});

test('main MCP discovers and invokes the same workspace service without gaining vote or membership powers',async()=>{const f=await connectedFixture();try{
 const headers={Authorization:'Bearer '+f.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',Host:'identity.example'},rpc=async(method,params)=>{const r=await personnel.fetch(new Request('https://identity.example/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),f.p.env,f.ctx);const body=await r.text();assert.equal(r.status,200,body);return JSON.parse(body.startsWith('{')?body:body.split('\n').find(l=>l.startsWith('data:')).slice(5)).result;};
 const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'workspace-test',version:'1'}});headers['MCP-Protocol-Version']=init.protocolVersion;
 const list=await rpc('tools/list',{});assert.ok(list.tools.some(t=>t.name==='knowledge_create_branch'));assert.equal(list.tools.find(t=>t.name==='knowledge_delete_branch').annotations.destructiveHint,true);const branch=await rpc('tools/call',{name:'knowledge_create_branch',arguments:{name:'MCP 知识修改',request_id:request()}});assert.ok(!branch.isError,JSON.stringify(branch));const stored=await f.call('/api/knowledge-workspace/branches');assert.ok(stored.body.branches.some(b=>b.id===branch.structuredContent.id));
 const main=await f.call('/api/knowledge-workspace/documents');assert.equal(main.body.documents.length,0);
 const invoke=async(name,args)=>{const r=await rpc('tools/call',{name,arguments:{...args,request_id:request()}});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
 const category=await invoke('knowledge_edit_category',{name:'MCP 独立分类',definition:'分类可独立讨论。'});
 const annotation=await invoke('knowledge_comment',{category_id:category.id,version_id:category.definition_version_id,quote:'分类可独立讨论。',start_offset:0,end_offset:8,body:'需要补充适用范围。'});
 const issue=await invoke('knowledge_issue_from_annotation',{comment_id:annotation.id,title:'讨论适用范围',body:'补充示例与边界。'});assert.ok(f.k.sqlite.prepare('SELECT source_json FROM kw_issues WHERE id=?').get(issue.id).source_json);
 const saved=await invoke('knowledge_save_document',{branch_id:branch.structuredContent.id,expected_version:1,title:'MCP 候审文档',body:'审核当前版本。',category:'MCP 独立分类',message:'准备审核'});
 const review=await invoke('knowledge_submit_review',{branch_id:branch.structuredContent.id,expected_version:saved.version,document_id:saved.id,version_id:saved.version_id});assert.equal(f.k.sqlite.prepare('SELECT auto_promote FROM kw_merges WHERE id=?').get(review.id).auto_promote,1);
 const version=f.k.sqlite.prepare('SELECT version FROM kw_branches WHERE id=?').get(review.branch_id).version;await invoke('knowledge_delete_branch',{branch_id:review.branch_id,expected_version:version});assert.equal(f.k.sqlite.prepare('SELECT state FROM kw_merges WHERE id=?').get(review.id).state,'closed');
}finally{await f.close();}});
