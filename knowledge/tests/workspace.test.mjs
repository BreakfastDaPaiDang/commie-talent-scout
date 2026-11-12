import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,request} from './fixture.mjs';
import {KnowledgeWorkspace} from '../src/workspace.ts';
import {locateAnnotation} from '../../app/shared/knowledge.ts';

function setup(){const f=fixture();return {...f,w:f.actors.map(a=>new KnowledgeWorkspace(f.db,a,f.clock))};}
async function change(w,name='修改方案',extra={}){const b=await w.createBranch({name,request_id:request()});const d=await w.save({branch_id:b.id,expected_version:b.version,title:'实际经历是判断的重要依据',body:'结合实际作品判断。了解可以投入的时间。',category:'知性',message:'新增条目',request_id:request(),...extra});return {b:await w.branch(b.id),d};}
async function propose(f,b){return f.w[0].propose({branch_id:b.id,expected_version:b.version,title:b.name,reason:'根据实际工作修订',request_id:request()});}
async function agree(f,m){for(const w of f.w.slice(0,3))await w.approve({id:m.id,head_id:m.head_id,request_id:request()});}
async function accept(f,m,extra={}){return f.w[0].accept({id:m.id,head_id:m.head_id,main_version:(await f.w[0].branch('main')).version,request_id:request(),...extra});}

test('three distinct eligible members are required; votes do not auto-merge; main rejects direct edits',async()=>{const f=setup();try{
 const {b,d}=await change(f.w[0]),m=await propose(f,b);
 await assert.rejects(accept(f,m),e=>e.code==='THREE_APPROVALS_REQUIRED');
 for(let i=0;i<4;i++)await f.w[0].approve({id:m.id,head_id:m.head_id,request_id:request()});
 assert.equal((await f.w[0].mergeRequests()).merges[0].approval_count,1);
 await agree(f,m);assert.equal((await f.w[0].list({})).documents.length,0);
 await accept(f,m);assert.equal((await f.w[0].get('main',d.id)).document.title,'实际经历是判断的重要依据');
 await assert.rejects(f.w[0].save({branch_id:'main',expected_version:2,title:'不能直接写',body:'正文',category:'知性',message:'绕过',request_id:request()}),e=>e.code==='MAIN_REQUIRES_MERGE');
}finally{f.close();}});

test('multiple qualified candidates coexist until an explicit issue choice; unselected requests and approvals survive',async()=>{const f=setup();try{
 const a=await change(f.w[0],'方案甲'),b=await change(f.w[0],'方案乙'),ma=await propose(f,a.b),mb=await propose(f,b.b);await agree(f,ma);await agree(f,mb);
 await assert.rejects(accept(f,ma),e=>e.code==='CONSENSUS_CHOICE_REQUIRED');assert.equal((await f.w[0].branch('main')).head_id,null);
 const issue=await f.w[0].createIssue({title:'选择本次共识方案',body:'讨论两项方案',request_id:request()});
 await f.w[1].setIssueState({id:issue.id,expected_version:1,state:'closed',resolution:'会议讨论后选择方案甲，乙保留。',selected_merge_id:ma.id,request_id:request()});
 await accept(f,ma,{selection:{kind:'issue',issue_id:issue.id}});
 const other=await f.w[0].mergeRequest(mb.id);assert.equal(other.state,'open');assert.equal(other.approval_count,3);assert.equal((await f.w[0].branch(b.b.id)).state,'open');
 assert.equal((await f.w[0].list({})).documents.length,1);
}finally{f.close();}});

test('editing or resolving a conflict invalidates old approvals; historical votes remain',async()=>{const f=setup();try{
 const initial=await change(f.w[0]),first=await propose(f,initial.b);await agree(f,first);await accept(f,first);
 const a=await f.w[0].createBranch({name:'改稿甲',request_id:request()}),b=await f.w[0].createBranch({name:'改稿乙',request_id:request()});
 for(const [branch,body] of [[a,'甲的正文'],[b,'乙的正文']])await f.w[0].save({branch_id:branch.id,expected_version:1,document_id:initial.d.id,title:'修改依据',body,category:'知性',message:'修改',request_id:request()});
 const ma=await propose(f,await f.w[0].branch(a.id)),mb=await propose(f,await f.w[0].branch(b.id));await agree(f,ma);await agree(f,mb);await accept(f,ma,{selection:{kind:'meeting',notes:'会议选择甲，保留乙供后续修订。'}});
 await assert.rejects(accept(f,mb),e=>e.code==='MERGE_CONFLICT');
 const before=await f.w[0].branch(b.id);await f.w[0].resolveConflict({branch_id:b.id,expected_version:before.version,document_id:initial.d.id,main_version:(await f.w[0].branch('main')).version,choice:'branch',request_id:request()});
 await assert.rejects(accept(f,mb),e=>e.code==='STALE_PROPOSAL');const revised=await propose(f,await f.w[0].branch(b.id));assert.equal((await f.w[0].mergeRequest(revised.id)).approval_count,0);await assert.rejects(accept(f,revised),e=>e.code==='THREE_APPROVALS_REQUIRED');
 await agree(f,revised);await accept(f,revised);assert.equal((await f.w[0].get('main',initial.d.id)).document.body,'乙的正文');assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM kw_approvals WHERE merge_id=?').get(mb.id).n,6);
}finally{f.close();}});

test('empty categories disappear per branch; a search yielding no documents does not remove them',async()=>{const f=setup();try{
 const {b,d}=await change(f.w[0]);assert.equal((await f.w[0].categories(b.id)).categories.length,1);const results=await f.w[0].list({branch_id:b.id,search:'无匹配文字'});assert.equal(results.documents.length,0);assert.equal(results.categories.length,1);
 await f.w[0].remove({branch_id:b.id,expected_version:b.version,document_id:d.id,message:'撤回此文档',request_id:request()});assert.equal((await f.w[0].categories(b.id)).categories.length,0);assert.ok(await f.w[0].version(d.version_id));
}finally{f.close();}});

test('annotations verify exact original text, stay under their quote, and preserve obsolete references safely',async()=>{const f=setup();try{
 const {b,d}=await change(f.w[0]),version=(await f.w[0].get(b.id,d.id)).document;
 const c=await f.w[0].comment({branch_id:b.id,document_id:d.id,version_id:version.id,quote:'结合实际作品判断。',start_offset:0,end_offset:9,body:'请附上作品。',request_id:request()});
 const original=(await f.w[0].comments({branch_id:b.id,document_id:d.id})).comments[0];assert.equal(original.id,c.id);assert.deepEqual(locateAnnotation(version.body,original,version.id),{start:0,end:9});
 assert.deepEqual(locateAnnotation('前文。'+version.body,original,'another'),{start:3,end:12});assert.equal(locateAnnotation('原句已被删除。',original,'another'),null);
 await assert.rejects(f.w[0].comment({branch_id:b.id,document_id:d.id,version_id:version.id,quote:'不存在',start_offset:0,end_offset:3,body:'批注',request_id:request()}),e=>e.code==='QUOTE_CHANGED');
 await assert.rejects(f.w[0].comment({branch_id:b.id,document_id:d.id,version_id:version.id,quote:version.body,start_offset:0,end_offset:version.body.length+1,body:'越界批注',request_id:request()}),e=>e.code==='QUOTE_CHANGED');
 await f.w[1].comment({branch_id:b.id,document_id:d.id,parent_id:c.id,body:'补充已收到。',request_id:request()});assert.equal((await f.w[0].comments({branch_id:b.id,document_id:d.id})).comments[1].quote,original.quote);
}finally{f.close();}});

test('guests see only main and cannot comment or approve; private branches and history stay private',async()=>{const f=setup();try{
 const {b,d}=await change(f.w[0]);f.sqlite.prepare("UPDATE kw_branches SET visibility='private' WHERE id=?").run(b.id);
 await assert.rejects(f.w[1].get(b.id,d.id),e=>e.code==='NOT_FOUND');await assert.rejects(f.w[1].commitDetail('main',d.commit_id),e=>e.code==='NOT_FOUND');
 const guest=new KnowledgeWorkspace(f.db,{kind:'guest',id:request(),name:'接收者',eligible:false});assert.equal((await guest.branches()).branches.length,1);await assert.rejects(guest.get(b.id,d.id),e=>e.code==='NOT_FOUND');await assert.rejects(guest.createIssue({title:'越权',body:'越权',request_id:request()}),e=>e.code==='FORMAL_MEMBER_REQUIRED');
}finally{f.close();}});

test('idempotent commands and concurrent stale edits cannot duplicate or silently overwrite',async()=>{const f=setup();try{
 const input={name:'重复请求',request_id:request()},first=await f.w[0].createBranch(input);assert.deepEqual(await f.w[0].createBranch(input),first);await assert.rejects(f.w[0].createBranch({...input,name:'改变请求'}),e=>e.code==='REQUEST_REUSED');
 const save={branch_id:first.id,expected_version:1,title:'竞争',body:'正文',category:'技术',message:'新增'};const settled=await Promise.allSettled(f.w.slice(0,2).map(w=>w.save({...save,request_id:request()})));assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.w[0].list({branch_id:first.id})).documents.length,1);
 assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
}finally{f.close();}});
