import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,request} from './fixture.mjs';
import {KnowledgeWorkspace} from '../src/workspace.ts';
import {locateAnnotation} from '../../app/shared/knowledge.ts';

function setup(){const f=fixture();return {...f,w:f.actors.map(a=>new KnowledgeWorkspace(f.db,a,f.clock)),guest:new KnowledgeWorkspace(f.db,{kind:'guest',id:request(),name:'接收者',eligible:false})};}
async function draft(w,name='私人草稿'){const b=await w.createBranch({name,visibility:'private',request_id:request()}),d=await w.save({branch_id:b.id,expected_version:1,title:name,body:'需要具体依据。',category:'知性',message:'准备草稿',request_id:request()});return {b:await w.branch(b.id),d};}
async function submit(w,b,d){return w.submitReview({branch_id:b.id,expected_version:b.version,document_id:d.id,version_id:d.version_id,request_id:request()});}
async function vote(w,m){return w.approve({id:m.id,head_id:m.head_id,request_id:request()});}

test('single-document publication leaves sibling drafts, private history and annotations private; retry does not duplicate',async()=>{const f=setup();try{
 const {b,d}=await draft(f.w[0]);const other=await f.w[0].save({branch_id:b.id,expected_version:b.version,title:'不要公开的另一篇',body:'私人内容。',category:'组织',message:'第二篇',request_id:request()});
 await f.w[0].comment({branch_id:b.id,document_id:d.id,body:'私人讨论',request_id:request()});
 const fresh=await f.w[0].branch(b.id),input={branch_id:b.id,expected_version:fresh.version,document_id:d.id,version_id:d.version_id,request_id:request()},m=await f.w[0].submitReview(input);
 assert.deepEqual(await f.w[0].submitReview(input),m);assert.equal((await f.w[0].submitReview({...input,request_id:request()})).id,m.id);
 assert.deepEqual((await f.w[1].list({scope:'public'})).documents.map(d=>d.document_id),[d.id]);
 assert.deepEqual((await f.w[0].list({scope:'drafts'})).documents.map(d=>d.document_id),[other.id]);
 assert.equal((await f.w[0].branch(b.id)).visibility,'private');assert.equal((await f.w[1].comments({branch_id:m.branch_id,document_id:d.id})).comments.length,0);
 await assert.rejects(f.w[1].get(m.branch_id,other.id),e=>e.code==='NOT_FOUND');await assert.rejects(f.w[1].history(b.id),e=>e.code==='NOT_FOUND');await assert.rejects(f.w[1].commitDetail(m.branch_id,d.commit_id),e=>e.code==='NOT_FOUND');
 await assert.rejects(f.guest.list({scope:'public'}),e=>e.code==='PUBLISHED_ONLY');assert.equal((await f.guest.list({})).documents.length,0);
}finally{f.close();}});

test('three distinct formal likes atomically publish a single review; author is not automatically counted',async()=>{const f=setup();try{
 const {b,d}=await draft(f.w[0]),m=await submit(f.w[0],b,d);assert.equal((await f.w[0].mergeRequest(m.id)).approval_count,0);
 await vote(f.w[0],m);await vote(f.w[0],m);await vote(f.w[1],m);assert.equal((await f.w[0].list({})).documents.length,0);assert.equal((await f.w[0].mergeRequest(m.id)).approval_count,2);
 await assert.rejects(vote(f.guest,m),e=>e.code==='FORMAL_MEMBER_REQUIRED');
 const input={id:m.id,head_id:m.head_id,request_id:request()},result=await f.w[2].approve(input);assert.equal(result.merged,true);assert.deepEqual(await f.w[2].approve(input),result);
 assert.equal((await f.w[0].mergeRequest(m.id)).state,'merged');assert.equal((await f.guest.get('main',d.id)).document.body,'需要具体依据。');assert.equal((await f.w[0].list({scope:'public'})).documents.length,0);
 assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
}finally{f.close();}});

test('parallel alternatives are not auto-selected by the first third vote; both survive until recorded choice',async()=>{const f=setup();try{
 const {b,d}=await draft(f.w[0]),a=await submit(f.w[0],b,d);
 const next=await f.w[0].save({branch_id:b.id,expected_version:b.version,document_id:d.id,title:'另一种表述',body:'新的候选依据。',category:'知性',message:'另一方案',request_id:request()}),other=await submit(f.w[0],await f.w[0].branch(b.id),next);
 for(const m of [a,other])for(const w of f.w.slice(0,3)){const result=await vote(w,m);assert.equal(result.merged,false);}
 assert.equal((await f.w[0].qualified()).length,2);assert.equal((await f.w[0].list({})).documents.length,0);
 await assert.rejects(f.w[0].accept({id:a.id,head_id:a.head_id,main_version:1,request_id:request()}),e=>e.code==='CONSENSUS_CHOICE_REQUIRED');
 await f.w[0].accept({id:a.id,head_id:a.head_id,main_version:1,selection:{kind:'meeting',notes:'共同选择第一种表述，另一个候选保留。'},request_id:request()});assert.equal((await f.w[0].mergeRequest(other.id)).state,'open');
}finally{f.close();}});

test('editing a public review invalidates its likes and stale draft submission is rejected',async()=>{const f=setup();try{
 const {b,d}=await draft(f.w[0]),m=await submit(f.w[0],b,d);await vote(f.w[0],m);await vote(f.w[1],m);
 const publicBranch=await f.w[0].branch(m.branch_id);await f.w[0].save({branch_id:publicBranch.id,expected_version:publicBranch.version,document_id:d.id,title:'修订',body:'改写后需重新认可。',category:'知性',message:'修订',request_id:request()});
 await assert.rejects(vote(f.w[2],m),e=>e.code==='STALE_PROPOSAL');assert.equal((await f.w[0].list({})).documents.length,0);
 await assert.rejects(f.w[0].submitReview({branch_id:b.id,expected_version:b.version,document_id:d.id,version_id:'wrong-version',request_id:request()}),e=>e.code==='CONFLICT');
}finally{f.close();}});

test('concurrent third likes cannot produce two main commits or partially accepted votes',async()=>{const f=setup();try{
 const {b,d}=await draft(f.w[0]),m=await submit(f.w[0],b,d);await vote(f.w[0],m);await vote(f.w[1],m);
 const results=await Promise.allSettled(f.w.slice(2).map(w=>vote(w,m)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.ok(results.filter(r=>r.status==='rejected').every(r=>['CONFLICT','STALE_PROPOSAL'].includes(r.reason.code)));
 assert.equal((await f.w[0].mergeRequest(m.id)).approval_count,3);assert.equal(f.sqlite.prepare("SELECT COUNT(*) n FROM kw_commits WHERE branch_id='main'").get().n,1);
 assert.equal((await f.w[0].get('main',d.id)).document.id,d.version_id);
}finally{f.close();}});

test('independent empty categories can be renamed and annotated; definition history and issue source survive edits',async()=>{const f=setup();try{
 const definition='表达需求的方式。明确合作条件。',c=await f.w[0].editCategory({name:'组织',definition,request_id:request()});
 const category=(await f.w[1].categories()).categories[0];assert.equal(category.count,0);assert.equal(category.id,c.id);assert.equal((await f.guest.categories()).categories.length,0);
 const quote='表达需求的方式。',a=await f.w[1].comment({category_id:c.id,version_id:c.definition_version_id,quote,start_offset:0,end_offset:quote.length,body:'是否也包括协调方式？',request_id:request()});
 const reply=await f.w[2].comment({category_id:c.id,parent_id:a.id,body:'可以结合工作实例讨论。',request_id:request()});
 assert.equal((await f.w[0].comments({category_id:c.id})).comments.find(x=>x.id===reply.id).quote,quote);
 const issue=await f.w[1].issueFromComment({comment_id:a.id,title:'讨论组织分类解释',body:'结合实际协作澄清边界。',request_id:request()});
 const updated=await f.w[0].editCategory({id:c.id,expected_version:1,name:'组织协作',definition:'共同协调活动的规则。',request_id:request()});
 const after=(await f.w[1].categories()).categories[0],comment=(await f.w[0].comments({category_id:c.id})).comments.find(x=>x.id===a.id);
 assert.equal(after.name,'组织协作');assert.equal(after.version,2);assert.equal(locateAnnotation(after.definition,comment,updated.definition_version_id),null);assert.equal((await f.w[0].version(c.definition_version_id)).body,definition);
 assert.equal(JSON.parse((await f.w[0].issue(issue.id)).source_json).quote,quote);assert.equal((await f.w[0].issue(issue.id)).category_id,c.id);
 await assert.rejects(f.w[0].editCategory({id:c.id,expected_version:1,name:'过期修改',definition:'不能覆盖',request_id:request()}),e=>e.code==='CONFLICT');
 await assert.rejects(f.w[0].comment({category_id:c.id,version_id:c.definition_version_id,quote,start_offset:0,end_offset:quote.length,body:'过期引用',request_id:request()}),e=>e.code==='QUOTE_CHANGED');
 assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
}finally{f.close();}});

test('private annotations cannot be exposed through public issues or shared category discussion',async()=>{const f=setup();try{
 const {b,d}=await draft(f.w[0]),quote='需要具体依据。',c=await f.w[0].comment({branch_id:b.id,document_id:d.id,version_id:d.version_id,quote,start_offset:0,end_offset:quote.length,body:'私人批注',request_id:request()});
 await assert.rejects(f.w[0].issueFromComment({comment_id:c.id,title:'公开问题',body:'不可偷带私稿',request_id:request()}),e=>e.code==='PRIVATE_SOURCE');
 await assert.rejects(f.w[1].issueFromComment({comment_id:c.id,title:'越权',body:'不可读取',request_id:request()}),e=>e.code==='NOT_FOUND');
 const category=(await f.w[0].categories(b.id)).categories[0];await f.w[0].defineCategory({id:category.id,branch_id:b.id,expected_version:1,definition:'私人类别说明。',request_id:request()});
 await f.w[0].comment({branch_id:b.id,category_id:category.id,body:'私人类别留言',request_id:request()});assert.equal((await f.w[1].categories()).categories.length,0);
 await submit(f.w[0],b,d);const publicBranch=(await f.w[1].list({scope:'public'})).documents[0].branch_id;
 assert.equal((await f.w[1].comments({branch_id:publicBranch,category_id:category.id})).comments.length,0);
}finally{f.close();}});
