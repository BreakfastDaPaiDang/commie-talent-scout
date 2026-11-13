import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,request} from './fixture.mjs';
import {KnowledgeWorkspace} from '../src/workspace.ts';

function setup(){const f=fixture();return {...f,w:f.actors.map(a=>new KnowledgeWorkspace(f.db,a,f.clock))};}
async function draft(w,visibility='members'){
 const b=await w.createBranch({name:request(),visibility,request_id:request()});
 const d=await w.save({branch_id:b.id,expected_version:1,title:'待讨论的知识',body:'判断需要依据。',category:'方法',message:'新增草稿',request_id:request()});
 return {b:await w.branch(b.id),d};
}
const deletion=b=>({branch_id:b.id,expected_version:b.version,request_id:request()});
const review=(w,b,d)=>w.submitReview({branch_id:b.id,expected_version:b.version,document_id:d.id,version_id:d.version_id,request_id:request()});

test('only an eligible branch creator may delete; main and private branches are protected; stale versions fail',async()=>{
 const f=setup();try{
  const {b,d}=await draft(f.w[1]);
  await assert.rejects(f.w[1].deleteBranch(deletion(await f.w[1].branch('main'))),e=>e.code==='MAIN_PROTECTED');
  // Even an administrator cannot delete someone else's public branch.
  await assert.rejects(f.w[0].deleteBranch(deletion(b)),e=>e.code==='OWNER_REQUIRED');
  const guest=new KnowledgeWorkspace(f.db,{kind:'guest',id:request(),name:'接收者',eligible:false});
  await assert.rejects(guest.deleteBranch(deletion(b)),e=>e.code==='FORMAL_MEMBER_REQUIRED');
  const former=new KnowledgeWorkspace(f.db,{...f.actors[1],eligible:false});
  await assert.rejects(former.deleteBranch(deletion(b)),e=>e.code==='FORMAL_MEMBER_REQUIRED');
  const privateDraft=await draft(f.w[1],'private');
  await assert.rejects(f.w[0].deleteBranch(deletion(privateDraft.b)),e=>e.code==='NOT_FOUND');
  await f.w[1].save({branch_id:b.id,expected_version:b.version,document_id:d.id,title:'新版本',body:'补充了内容。',category:'方法',message:'协作更新',request_id:request()});
  await assert.rejects(f.w[1].deleteBranch(deletion(b)),e=>e.code==='CONFLICT');
  assert.ok((await f.w[1].branches()).branches.some(x=>x.id===b.id));
 }finally{f.close();}
});

test('deletion hides a branch and closes review atomically, while preserving votes, annotations and linked issues',async()=>{
 const f=setup();try{
  const {b,d}=await draft(f.w[0]);
  const annotation=await f.w[0].comment({branch_id:b.id,document_id:d.id,version_id:d.version_id,quote:'判断需要依据。',start_offset:0,end_offset:7,body:'请说明依据。',request_id:request()});
  const issue=await f.w[0].issueFromComment({comment_id:annotation.id,title:'明确依据',body:'如何提供依据？',request_id:request()});
  const m=await f.w[0].propose({branch_id:b.id,expected_version:b.version,title:'待审',reason:'共同讨论',request_id:request()});
  await f.w[1].approve({id:m.id,head_id:m.head_id,request_id:request()});
  const input=deletion(b),result=await f.w[0].deleteBranch(input);
  assert.equal(result.deleted,true);assert.deepEqual(await f.w[0].deleteBranch(input),result);
  assert.equal((await f.w[0].branches()).branches.some(x=>x.id===b.id),false);
  assert.equal((await f.w[0].mergeRequests()).merges.some(x=>x.id===m.id),false);
  assert.equal((await f.w[0].list({scope:'public'})).documents.length,0);
  for(const read of [()=>f.w[0].branch(b.id),()=>f.w[0].get(b.id,d.id),()=>f.w[0].history(b.id),()=>f.w[0].comments({branch_id:b.id,document_id:d.id})])await assert.rejects(read(),e=>e.code==='NOT_FOUND');
  await assert.rejects(f.w[1].approve({id:m.id,head_id:m.head_id,request_id:request()}),e=>e.code==='NOT_FOUND');
  assert.equal(f.sqlite.prepare('SELECT state FROM kw_merges WHERE id=?').get(m.id).state,'closed');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM kw_approvals WHERE merge_id=?').get(m.id).n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM kw_comments WHERE id=?').get(annotation.id).n,1);
  assert.equal(JSON.parse((await f.w[1].issue(issue.id)).source_json).quote,'判断需要依据。');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM kw_events WHERE action='branch.delete'").get().n,1);
  assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{f.close();}
});

test('deleting a pending single-document review returns its draft to the draft list and permits fresh submission',async()=>{
 const f=setup();try{
  const {b,d}=await draft(f.w[0],'private'),m=await review(f.w[0],b,d);
  assert.equal((await f.w[0].list({scope:'drafts'})).documents.length,0);
  await f.w[0].deleteBranch(deletion(await f.w[0].branch(m.branch_id)));
  assert.equal((await f.w[0].list({scope:'drafts'})).documents[0].id,d.version_id);
  const again=await review(f.w[0],b,d);assert.notEqual(again.id,m.id);assert.notEqual(again.branch_id,m.branch_id);
  assert.equal((await f.w[0].mergeRequest(again.id)).approval_count,0);
  assert.equal((await f.w[0].list({scope:'drafts'})).documents.length,0);
 }finally{f.close();}
});

test('deleting a merged branch keeps main content, reachable history and completed review; deleting the source does not withdraw its published review',async()=>{
 const f=setup();try{
  const {b,d}=await draft(f.w[0],'private'),m=await review(f.w[0],b,d);
  await f.w[0].deleteBranch(deletion(b));
  assert.equal((await f.w[0].list({scope:'drafts'})).documents.length,0);
  assert.equal((await f.w[0].mergeRequest(m.id)).state,'open');
  for(const w of f.w.slice(0,3))await w.approve({id:m.id,head_id:m.head_id,request_id:request()});
  const before=await f.w[0].branch('main'),history=await f.w[0].history('main');
  await f.w[0].deleteBranch(deletion(await f.w[0].branch(m.branch_id)));
  assert.deepEqual(await f.w[0].branch('main'),before);
  assert.equal((await f.w[0].get('main',d.id)).document.id,d.version_id);
  assert.deepEqual(await f.w[0].history('main'),history);
  for(const commit of history.commits)assert.ok((await f.w[0].commitDetail('main',commit.id)).commit);
  assert.equal(f.sqlite.prepare('SELECT state FROM kw_merges WHERE id=?').get(m.id).state,'merged');
  const guest=new KnowledgeWorkspace(f.db,{kind:'guest',id:request(),name:'接收者',eligible:false});
  assert.equal((await guest.get('main',d.id)).document.id,d.version_id);
 }finally{f.close();}
});

test('deletion racing with a merge cannot publish after a successful delete or remove already merged content',async()=>{
 const f=setup();try{
  const {b,d}=await draft(f.w[0]),m=await f.w[0].propose({branch_id:b.id,expected_version:b.version,title:'并发审核',reason:'测试',request_id:request()});
  for(const w of f.w.slice(0,3))await w.approve({id:m.id,head_id:m.head_id,request_id:request()});
  const settled=await Promise.allSettled([f.w[0].deleteBranch(deletion(b)),f.w[0].accept({id:m.id,head_id:m.head_id,main_version:1,request_id:request()})]);
  assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);
  const deleted=settled[0].status==='fulfilled';assert.equal((await f.w[0].list({})).documents.length,deleted?0:1);
  if(!deleted)assert.equal((await f.w[0].get('main',d.id)).document.id,d.version_id);
  assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{f.close();}
});
