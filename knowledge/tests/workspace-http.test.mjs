import test from 'node:test';
import assert from 'node:assert/strict';
import {connectedFixture} from './connected-fixture.mjs';
import {request} from './fixture.mjs';
import personnel from '../../app/server/index.ts';
import worker from '../src/index.ts';
import {KnowledgeWorkspace} from '../src/workspace.ts';
import {emptyCatalogContent} from '../../app/shared/catalog.ts';

async function connectMcp(f,direct=false){
 const origin=direct?f.env.APP_ORIGIN:'https://identity.example';
 const headers={Authorization:'Bearer '+f.token,'Content-Type':'application/json',Accept:'application/json, text/event-stream',Host:new URL(origin).hostname};
 const rpc=async(method,params)=>{
  const input=new Request(origin+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const r=direct?await worker.fetch(input,f.env,f.ctx):await personnel.fetch(input,f.p.env,f.ctx);
  const body=await r.text();assert.equal(r.status,200,body);
  return JSON.parse(body.startsWith('{')?body:body.split('\n').find(l=>l.startsWith('data:')).slice(5)).result;
 };
 const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'workspace-test',version:'1'}});
 headers['MCP-Protocol-Version']=init.protocolVersion;
 return rpc;
}

async function approveTag(f,proposal){
 for(const actor of f.k.actors.slice(0,3)){
  await new KnowledgeWorkspace(f.k.db,actor).approveTag({id:proposal.proposal_id,request_id:request()});
 }
 return f.k.sqlite.prepare('SELECT * FROM kw_categories WHERE id=?').get(proposal.id);
}

test('workspace crosses the fixed main-site cookie bridge and stores comments only in independent D1',async()=>{const f=await connectedFixture();try{
 const origin='https://identity.example',headers={Cookie:'cts_session='+f.session,Origin:origin,'Content-Type':'application/json'};
 const call=async(path,body)=>{const r=await personnel.fetch(new Request(origin+'/api/knowledge-workspace'+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify({...body,request_id:request()}):undefined}),f.p.env,f.ctx);return {status:r.status,data:await r.json()};};
 const b=await call('/branches',{name:'网页分支'});assert.equal(b.status,200,JSON.stringify(b));const doc=await call('/documents',{branch_id:b.data.id,expected_version:1,title:'接口验证',body:'这是第一句。\n这是第二句。',category:'自建分类',message:'创建'});assert.equal(doc.status,200,JSON.stringify(doc));
 const post=await call('/comments',{branch_id:b.data.id,document_id:doc.data.id,body:'这是文末评论'});assert.equal(post.status,200,JSON.stringify(post));assert.equal(f.k.sqlite.prepare('SELECT COUNT(*) n FROM kw_comments').get().n,1);assert.equal(f.p.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='kw_comments'").get().n,0);
 const query=new URLSearchParams({branch_id:b.data.id,document_id:doc.data.id});
 const activity=await call('/activity?'+query);assert.equal(activity.status,200,JSON.stringify(activity));
 assert.deepEqual(activity.data.entries.map(e=>[e.kind,e.body]).sort(),[['comment','这是文末评论'],['commit','创建']]);
 const version=await call('/history/'+doc.data.commit_id+'?'+query);assert.equal(version.status,200,JSON.stringify(version));
 assert.deepEqual(version.data.changes.map(c=>c.document_id),[doc.data.id]);
 const tag=await call('/categories',{name:'网页提议'});assert.equal(tag.status,200,JSON.stringify(tag));
 const tagPath='/tag-proposals/'+tag.data.proposal_id;
 const pending=await call(tagPath);assert.equal(pending.status,200,JSON.stringify(pending));
 assert.deepEqual(pending.data.proposal,(await call('/tag-proposals')).data.proposals.find(p=>p.id===tag.data.proposal_id));
 assert.equal(pending.data.proposal.author_id,f.p.actor.id);
 assert.equal(pending.data.proposal.state,'pending');
 assert.equal((await call('/tag-proposals/'+request())).status,404);
 assert.equal((await f.call('/api/knowledge-workspace'+tagPath)).status,404);
 assert.equal((await f.call('/api/knowledge-workspace'+tagPath,undefined,{Cookie:'cts_session='+f.session,'X-Knowledge-MCP':'1'})).status,404);
 await approveTag(f,tag.data);
 const adopted=await call(tagPath);assert.equal(adopted.status,200,JSON.stringify(adopted));
 assert.equal(adopted.data.proposal.state,'approved');
 assert.equal(adopted.data.proposal.approval_count,3);
 assert.equal((await f.call('/api/knowledge-workspace'+tagPath)).status,404);
 const cross=await personnel.fetch(new Request(origin+'/api/knowledge-workspace/comments',{method:'POST',headers:{...headers,Origin:'https://other.example'},body:JSON.stringify({branch_id:b.data.id,document_id:doc.data.id,body:'越权来源',request_id:request()})}),f.p.env,f.ctx);assert.equal(cross.status,403);
 const deleted=await call('/branches/delete',{branch_id:b.data.id,expected_version:doc.data.version});assert.equal(deleted.status,200,JSON.stringify(deleted));assert.equal(deleted.data.deleted,true);assert.equal((await call('/branches')).data.branches.some(x=>x.id===b.data.id),false);assert.equal((await call('/documents/'+doc.data.id+'?branch_id='+b.data.id)).status,404);assert.equal((await call('/branches/delete',{branch_id:'main',expected_version:1})).status,403);
 f.p.sqlite.prepare('UPDATE archives SET closed=1 WHERE id=?').run(f.membership);assert.equal((await call('/branches')).status,403);
}finally{await f.close();}});

test('main MCP discovers and invokes the same workspace service without gaining vote or membership powers',async()=>{const f=await connectedFixture();try{
 const rpc=await connectMcp(f);
 const list=await rpc('tools/list',{});assert.ok(list.tools.some(t=>t.name==='knowledge_create_branch'));assert.equal(list.tools.find(t=>t.name==='knowledge_delete_branch').annotations.destructiveHint,true);const branch=await rpc('tools/call',{name:'knowledge_create_branch',arguments:{name:'MCP 知识修改',request_id:request()}});assert.ok(!branch.isError,JSON.stringify(branch));const stored=await f.call('/api/knowledge-workspace/branches');assert.ok(stored.body.branches.some(b=>b.id===branch.structuredContent.id));
 const main=await f.call('/api/knowledge-workspace/documents');assert.equal(main.body.documents.length,0);
 const invoke=async(name,args)=>{const r=await rpc('tools/call',{name,arguments:{...args,request_id:request()}});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent;};
 const created=await invoke('knowledge_edit_category',{name:'MCP 独立分类',definition:'分类可独立讨论。'});
 assert.deepEqual(created,{submitted:true});
 const proposal=f.k.sqlite.prepare("SELECT id AS proposal_id,category_id AS id FROM kw_tag_proposals WHERE name='MCP 独立分类'").get();
 const category=await approveTag(f,proposal);
 const annotation=await invoke('knowledge_comment',{category_id:category.id,version_id:category.definition_version_id,quote:'分类可独立讨论。',start_offset:0,end_offset:8,body:'需要补充适用范围。'});
 const issue=await invoke('knowledge_issue_from_annotation',{comment_id:annotation.id,title:'讨论适用范围',body:'补充示例与边界。'});assert.ok(f.k.sqlite.prepare('SELECT source_json FROM kw_issues WHERE id=?').get(issue.id).source_json);
 const saved=await invoke('knowledge_save_document',{branch_id:branch.structuredContent.id,expected_version:1,title:'MCP 候审文档',body:'审核当前版本。',category:'MCP 独立分类',message:'准备审核'});
 const review=await invoke('knowledge_submit_review',{branch_id:branch.structuredContent.id,expected_version:saved.version,document_id:saved.id,version_id:saved.version_id});assert.equal(f.k.sqlite.prepare('SELECT auto_promote FROM kw_merges WHERE id=?').get(review.id).auto_promote,1);
 const version=f.k.sqlite.prepare('SELECT version FROM kw_branches WHERE id=?').get(review.branch_id).version;await invoke('knowledge_delete_branch',{branch_id:review.branch_id,expected_version:version});assert.equal(f.k.sqlite.prepare('SELECT state FROM kw_merges WHERE id=?').get(review.id).state,'closed');
}finally{await f.close();}});

test('main MCP, independent MCP and guests omit unapproved tag metadata across workspace reads',async()=>{const f=await connectedFixture();try{
 const origin=f.env.APP_ORIGIN,prefix='/api/knowledge-workspace';
 const memberHeaders={Cookie:'cts_session='+f.session,Origin:origin};
 const web=async(path,input)=>{
  const r=await f.call(prefix+path,input===undefined?undefined:{request_id:request(),...input},memberHeaders);
  assert.equal(r.status,200,JSON.stringify(r.body));
  return r.body;
 };
 const visibleName='认可的词义',primaryName='尚待确认甲',secondaryName='尚待确认乙',definition='这段含义尚在讨论。';
 const visible=await approveTag(f,await web('/categories',{name:visibleName,definition:'已经达成共识。'}));
 const proposalRequest=request(),primary=await web('/categories',{name:primaryName,definition,request_id:proposalRequest});
 const secondary=await web('/categories',{name:secondaryName});
 const definitionId=request(),definitionDocument='category-'+primary.id,at=new Date().toISOString();
 // A migrated tag can have a reference to the definition and annotations from before the ballot.
 f.k.sqlite.prepare('INSERT INTO kw_documents VALUES(?,?,?,?)').run(definitionDocument,f.p.actor.id,f.p.actor.name,at);
 f.k.sqlite.prepare("INSERT INTO kw_versions VALUES(?,?,?,?,?,'分类解释','',0,?,?,?)")
  .run(definitionId,definitionDocument,primaryName,definition,primary.id,f.p.actor.id,f.p.actor.name,at);
 f.k.sqlite.prepare('UPDATE kw_categories SET definition_version_id=? WHERE id=?').run(definitionId,primary.id);
 const note=await web('/comments',{category_id:primary.id,version_id:definitionId,quote:definition,start_offset:0,end_offset:definition.length,body:'尚未公开的标签解释批注'});
 const issue=await web('/issues/from-comment',{comment_id:note.id,title:'核对词义',body:'请补充依据。'});
 assert.equal(JSON.parse((await web('/issues/'+issue.id)).issue.source_json).quote,definition);

 const branch=await web('/branches',{name:'测试审议',visibility:'private'});
 const doc=await web('/documents',{branch_id:branch.id,expected_version:1,title:'正文样例',body:'一篇需要独立审核的文档。',category:primaryName,additional_tags:[secondaryName,visibleName],message:'准备文档'});
 const review=await web('/reviews',{branch_id:branch.id,expected_version:doc.version,document_id:doc.id,version_id:doc.version_id});
 const reviewPath='/documents/'+doc.id+'?branch_id='+review.branch_id;
 assert.deepEqual((await web(reviewPath)).document.tags.map(tag=>[tag.name,tag.pending]),[[primaryName,1],[secondaryName,1],[visibleName,0]]);
 assert.equal((await web('/merges')).merges.find(m=>m.id===review.id).changes[0].tags[0].pending,1);
 const hidden=[primary.id,secondary.id,primaryName,secondaryName,definition,note.id,issue.id];
 function omitsPending(value){
  const json=JSON.stringify(value);
  for(const token of hidden)assert.ok(!json.includes(token),json);
 }
 const clients=await Promise.all([connectMcp(f),connectMcp(f,true)]);
 for(const rpc of clients){
  const call=(name,args={})=>rpc('tools/call',{name,arguments:args});
  const read=async(name,args)=>{
   const result=await call(name,args);assert.ok(!result.isError,JSON.stringify(result));return result.structuredContent;
  };
  const pendingList=await read('knowledge_documents',{scope:'public'});
  assert.equal(pendingList.documents.length,1);omitsPending(pendingList);
  assert.deepEqual((await read('knowledge_documents',{scope:'public',category_id:primary.id})).documents,[]);
  assert.deepEqual((await read('knowledge_documents',{scope:'public',category_id:secondary.id})).documents,[]);
  const detail=await read('knowledge_document',{branch_id:review.branch_id,id:doc.id});
  assert.equal(detail.document.category_id,null);assert.equal(detail.document.category_name,null);
  assert.deepEqual(detail.document.tags.map(tag=>tag.id),[visible.id]);omitsPending(detail);
  omitsPending(await read('knowledge_compare',{branch_id:review.branch_id}));
  omitsPending(await read('knowledge_merges',{}));
  omitsPending(await read('knowledge_history',{branch_id:review.branch_id}));
  assert.deepEqual((await read('knowledge_issues',{})).issues,[]);
  assert.equal((await call('knowledge_comments',{category_id:primary.id})).structuredContent.error.code,'NOT_FOUND');
  assert.equal((await call('knowledge_comments',{issue_id:issue.id})).structuredContent.error.code,'NOT_FOUND');
  const receipt=await read('knowledge_request',{request_id:proposalRequest});
  assert.deepEqual(receipt.result,{submitted:true});omitsPending(receipt);
 }

 for(const actor of f.k.actors.slice(0,3)){
  await new KnowledgeWorkspace(f.k.db,actor).approve({id:review.id,head_id:review.head_id,request_id:request()});
 }
 const main=await f.call(prefix+'/documents');
 const revision=main.body.tag_revision,head=main.body.branch.head_id;
 const path='/history/'+head;
 const detail=await f.call(prefix+path);
 assert.equal(detail.status,200);assert.equal(detail.body.changes[0].after.category_id,null);omitsPending(detail.body);
 assert.equal((await f.call(prefix+'/issues/'+issue.id)).status,404);
 assert.equal((await f.call(prefix+'/tag-proposals')).body.proposals.length,0);
 assert.equal((await f.call(prefix+'/categories')).body.categories.length,1);
 const resource=await f.call('/api/catalog/entries',{id:request(),request_id:request(),record_kind:'resource',content:{...emptyCatalogContent(),name:'访问验证',owner_id:f.p.actor.id,note:'测试资源说明'}});
 assert.equal(resource.status,200);
 const grant=await f.call('/api/catalog/grants',{id:request(),request_id:request(),entry_id:resource.body.id,recipient_name:'测试接收者',receiver_id:f.p.actor.id});
 assert.equal(grant.status,200);
 const guestHeaders={Cookie:'cts_candy='+grant.body.access_key};
 for(const readPath of ['/documents','/documents/'+doc.id,'/categories',path]){
  const r=await f.call(prefix+readPath,undefined,guestHeaders);assert.equal(r.status,200,JSON.stringify(r.body));omitsPending(r.body);
 }
 assert.equal((await f.call(prefix+'/documents?category_id='+primary.id,undefined,guestHeaders)).body.documents.length,0);
 assert.equal((await f.call(prefix+'/comments?category_id='+primary.id,undefined,guestHeaders)).status,404);
 assert.equal((await f.call(prefix+'/tag-proposals/'+primary.proposal_id,undefined,guestHeaders)).status,404);
 await approveTag(f,primary);
 assert.equal((await f.call(prefix+'/tag-proposals/'+primary.proposal_id,undefined,guestHeaders)).status,404);
 const next=await f.call(prefix+'/documents?category_id='+primary.id);
 assert.equal(next.body.branch.head_id,head);
 assert.equal(next.body.tag_revision,revision+1);
 assert.equal(next.body.documents[0].category_id,primary.id);
 assert.deepEqual(next.body.documents[0].tags.map(tag=>tag.id),[primary.id,visible.id]);
}finally{await f.close();}});
