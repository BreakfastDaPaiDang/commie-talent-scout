import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,request} from './fixture.mjs';
import {KnowledgeWorkspace} from '../src/workspace.ts';

function setup(t) {
  const f=fixture();t.after(f.close);
  return {f, services:f.actors.map(actor=>new KnowledgeWorkspace(f.db,actor,f.clock))};
}
async function submitDoc(w) {
  const branch=await w.createBranch({name:'原稿',visibility:'private',request_id:request()});
  const saved=await w.save({branch_id:branch.id,expected_version:1,title:'原稿',body:'已讨论的文本',message:'草稿',request_id:request()});
  const args={branch_id:branch.id,expected_version:saved.version,document_id:saved.id,version_id:saved.version_id};
  return {args,review:await w.submitReview({...args,request_id:request()})};
}
const voteDoc=(w,r)=>w.approve({id:r.id,head_id:r.head_id,request_id:request()});
const withdrawDoc=(w,r)=>w.withdrawReview({id:r.id,head_id:r.head_id,request_id:request()});
const voteTag=(w,id)=>w.approveTag({id,request_id:request()});

test('author can retrieve their exact two-vote submission without undoing later private edits',async t=>{
  const {services:[a,b,c]}=setup(t),{args,review}=await submitDoc(a);
  await voteDoc(a,review);await voteDoc(b,review);
  await assert.rejects(withdrawDoc(b,review),{code:'AUTHOR_REQUIRED'});
  await a.save({branch_id:args.branch_id,expected_version:args.expected_version,document_id:args.document_id,title:'另一份改稿',body:'更新的内容',message:'另存进展',request_id:request()});
  const input={id:review.id,head_id:review.head_id,request_id:request()};
  const draft=await a.withdrawReview(input);
  assert.equal((await a.withdrawReview(input)).branch_id,draft.branch_id);
  assert.notEqual(draft.branch_id,args.branch_id);
  assert.deepEqual(new Set((await a.list({scope:'drafts'})).documents.map(d=>d.title)),new Set(['另一份改稿','原稿']));
  assert.equal((await a.mergeRequest(review.id)).approval_count,2);
  assert.equal((await b.list({scope:'public'})).documents.length,0);
  await assert.rejects(voteDoc(c,review));
  await assert.rejects(b.get(draft.branch_id,draft.document_id));
  const r=await a.submitReview({...args,branch_id:draft.branch_id,expected_version:1,request_id:request()});
  assert.equal((await a.mergeRequest(r.id)).approval_count,0);
  for(const w of [a,b,c])await voteDoc(w,r);
  await assert.rejects(withdrawDoc(a,r),{code:'BALLOT_CLOSED'});
});
test('tag draft survives reload, protects the original votes, and opens an independent round',async t=>{
  const {f,services:[a,b,c]}=setup(t),tag=await a.editCategory({name:'词义',definition:'原解释',request_id:request()});
  const id=tag.proposal_id;
  for(const w of [a,b])await voteTag(w,id);
  await assert.rejects(b.withdrawTag({id,request_id:request()}),{code:'AUTHOR_REQUIRED'});
  await a.withdrawTag({id,request_id:request()});
  assert.equal((await a.tagProposals()).proposals.length,0);
  assert.equal((await b.tagProposals()).drafts.length,0);
  assert.equal((await b.tagProposal(id)).draft,undefined);
  await assert.rejects(voteTag(c,id),{code:'TAG_VOTE_CLOSED'});
  const edit={id,name:'词义修订',definition:'更新的解释',expected_version:1,submit:false,request_id:request()};
  await assert.rejects(b.saveTagDraft(edit),{code:'AUTHOR_REQUIRED'});
  await a.saveTagDraft(edit);
  assert.equal((await new KnowledgeWorkspace(f.db,f.actors[0],f.clock).tagProposals()).drafts[0].draft.name,'词义修订');
  await assert.rejects(a.saveTagDraft({...edit,request_id:request()}),{code:'CONFLICT'});
  f.advance(86400000);
  const r=await a.saveTagDraft({...edit,expected_version:2,submit:true,request_id:request()});
  const fresh=await b.tagProposal(r.proposal_id);
  assert.equal(fresh.approval_count,0);assert.equal(fresh.category_id,tag.id);
  assert.equal(Date.parse(fresh.expires_at)-Date.parse(f.clock()),7*86400000);
  assert.equal((await a.tagProposals()).drafts.length,0);assert.equal((await b.tagProposal(id)).approval_count,2);
  for(const w of [a,b,c])await voteTag(w,r.proposal_id);
  await assert.rejects(a.withdrawTag({id:r.proposal_id,request_id:request()}),{code:'BALLOT_CLOSED'});
  assert.equal((await a.category('main',tag.id)).name,'词义修订');
  const editTag=await b.editCategory({id:tag.id,name:'新名称',definition:'新提议',expected_version:2,request_id:request()});
  await b.withdrawTag({id:editTag.proposal_id,request_id:request()});
  assert.equal((await a.category('main',tag.id)).name,'词义修订');
});
for(const kind of ['document','tag'])test(kind+' third vote racing withdrawal commits exactly one result',async t=>{
  const {services:[a,b,c]}=setup(t);
  let approve,withdraw,read;
  if(kind==='document'){
    const {review}=await submitDoc(a);
    approve=w=>voteDoc(w,review);withdraw=()=>withdrawDoc(a,review);read=()=>a.mergeRequest(review.id);
  }else{
    const tag=await a.editCategory({name:'竞争测试',definition:'原文',request_id:request()});
    approve=w=>voteTag(w,tag.proposal_id);withdraw=()=>a.withdrawTag({id:tag.proposal_id,request_id:request()});read=()=>a.tagProposal(tag.proposal_id);
  }
  await approve(a);await approve(b);
  const results=await Promise.allSettled([withdraw(),approve(c)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const r=await read();
  if(results[0].status==='fulfilled'){
    assert.equal(r.approval_count,2);assert.equal(r.state,kind==='document'?'closed':'withdrawn');
  }else{
    assert.equal(r.approval_count,3);assert.equal(r.state,kind==='document'?'merged':'approved');
  }
});
