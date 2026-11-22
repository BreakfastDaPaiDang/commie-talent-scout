import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMigration,applyMigrationsAfter,fixture,request} from './fixture.mjs';
import {KnowledgeWorkspace} from '../src/workspace.ts';
import {locateAnnotation} from '../../app/shared/knowledge.ts';

const week=7*24*60*60*1000;
function setup(options){const f=fixture(options);return {...f,w:f.actors.map(a=>new KnowledgeWorkspace(f.db,a,f.clock)),guest:new KnowledgeWorkspace(f.db,{kind:'guest',id:request(),name:'接收者',eligible:false})};}
async function draft(w,name='私人草稿'){const b=await w.createBranch({name,visibility:'private',request_id:request()}),d=await w.save({branch_id:b.id,expected_version:1,title:name,body:'需要具体依据。',category:'知性',message:'准备草稿',request_id:request()});return {b:await w.branch(b.id),d};}
async function submit(w,b,d){return w.submitReview({branch_id:b.id,expected_version:b.version,document_id:d.id,version_id:d.version_id,request_id:request()});}
async function vote(w,m){return w.approve({id:m.id,head_id:m.head_id,request_id:request()});}
function legacyMerge(f,branch,approvalCount=0,state='open',at=f.clock()){
 const id=request(),head_id=branch.head_id,[author]=f.actors;
 f.sqlite.prepare('INSERT INTO kw_merges(id,branch_id,head_id,title,reason,state,author_id,author_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run(id,branch.id,head_id,branch.name,'此前提交',state,author.id,author.name,at,at);
 const approve=f.sqlite.prepare('INSERT INTO kw_approvals VALUES(?,?,?,?,?,?,?)');
 for(const actor of f.actors.slice(0,approvalCount))approve.run(id,head_id,actor.id,actor.name,actor.membership_id,at,at);
 return {id,head_id};
}
function seedLegacyBranch(f,name,at,{visibility='members',categoryId=null}={}){
 const branch={id:request(),head_id:request(),name},version=request(),document=request(),[author]=f.actors;
 f.sqlite.prepare('INSERT INTO kw_branches(id,name,owner_id,owner_name,visibility,head_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
   .run(branch.id,name,author.id,author.name,visibility,branch.head_id,at,at);
 f.sqlite.prepare('INSERT INTO kw_documents VALUES(?,?,?,?)').run(document,author.id,author.name,at);
 f.sqlite.prepare('INSERT INTO kw_versions(id,document_id,title,body,author_id,author_name,created_at,category_id) VALUES(?,?,?,?,?,?,?,?)')
   .run(version,document,name,'此前版本的内容',author.id,author.name,at,categoryId);
 f.sqlite.prepare('INSERT INTO kw_commits(id,branch_id,message,author_id,author_name,created_at) VALUES(?,?,?,?,?,?)')
   .run(branch.head_id,branch.id,'此前提交',author.id,author.name,at);
 f.sqlite.prepare('INSERT INTO kw_changes VALUES(?,?,NULL,?)').run(branch.head_id,document,version);
 f.sqlite.prepare('INSERT INTO kw_items VALUES(?,?,?,NULL)').run(branch.id,document,version);
 return {...branch,document};
}

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
 await vote(f.w[0],m);await vote(f.w[0],m);
 const rebound=new KnowledgeWorkspace(f.db,{...f.actors[0],id:request()},f.clock);
 const newMembership=new KnowledgeWorkspace(f.db,{...f.actors[0],membership_id:request()},f.clock);
 assert.equal((await rebound.mergeRequest(m.id)).approved_by_me,1);
 assert.equal((await rebound.approve({id:m.id,head_id:m.head_id,request_id:request()})).approval_count,1);
 assert.equal((await newMembership.approve({id:m.id,head_id:m.head_id,request_id:request()})).approval_count,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM kw_approvals WHERE merge_id=?').get(m.id).n,1);
 await vote(f.w[1],m);assert.equal((await f.w[0].list({})).documents.length,0);assert.equal((await f.w[0].mergeRequest(m.id)).approval_count,2);
 const voters=(await f.w[0].mergeRequest(m.id)).approvers;
 assert.deepEqual(new Set(voters.map(v=>v.id)),new Set(f.actors.slice(0,2).map(actor=>actor.id)));
 assert.ok(voters.every(v=>v.name&&v.created_at));
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

test('approval closes at seven days, while expired drafts can be resubmitted without their old votes',async()=>{const f=setup();try{
 const {b,d}=await draft(f.w[0]),m=await submit(f.w[0],b,d);
 assert.equal(Date.parse(m.expires_at)-Date.parse(f.clock()),week);
 await vote(f.w[0],m);f.advance(week-1);await vote(f.w[1],m);f.advance(1);
 await assert.rejects(vote(f.w[2],m),e=>e.code==='REVIEW_DEADLINE_PASSED');
 await assert.rejects(f.w[0].accept({id:m.id,head_id:m.head_id,main_version:1,request_id:request()}),e=>e.code==='REVIEW_DEADLINE_PASSED');
 const expired=await f.w[0].mergeRequest(m.id);assert.equal(expired.expired,true);assert.equal(expired.approval_count,2);
 assert.equal((await f.w[1].list({scope:'public'})).documents.length,0);
 assert.deepEqual((await f.w[0].list({scope:'drafts'})).documents.map(v=>v.id),[d.version_id]);
 const renewed=await submit(f.w[0],b,d);assert.notEqual(renewed.id,m.id);
 assert.equal(Date.parse(renewed.expires_at)-Date.parse(f.clock()),week);
 for(const w of f.w.slice(0,3))await vote(w,renewed);
 assert.equal((await f.w[0].get('main',d.id)).document.id,d.version_id);
 assert.equal((await f.w[0].mergeRequest(m.id)).approval_count,2);
}finally{f.close();}});

test('independent documents auto-merge even while an unrelated candidate waits for resolution',async()=>{const f=setup();try{
 const {b,d}=await draft(f.w[0]),a=await submit(f.w[0],b,d);
 const next=await f.w[0].save({branch_id:b.id,expected_version:b.version,document_id:d.id,title:'并行候选',body:'独立表述。',category:'知性',message:'新增候选',request_id:request()});
 const competitor=await submit(f.w[0],await f.w[0].branch(b.id),next);
 for(const w of f.w.slice(0,3))assert.equal((await vote(w,a)).merged,false);
 const unrelated=await draft(f.w[0],'不同文档'),separate=await submit(f.w[0],unrelated.b,unrelated.d);
 for(const w of f.w.slice(0,3))await vote(w,separate);
 assert.equal((await f.w[0].mergeRequest(separate.id)).state,'merged');
 f.advance(7*24*60*60*1000);
 const qualified=await f.w[0].mergeRequest(a.id),expired=await f.w[0].mergeRequest(competitor.id);
 assert.equal(qualified.expired,false);assert.equal(qualified.voting_closed,true);assert.equal(expired.expired,true);
 await assert.rejects(vote(f.w[3],a),e=>e.code==='REVIEW_DEADLINE_PASSED');
 await f.w[0].accept({id:a.id,head_id:a.head_id,main_version:(await f.w[0].branch('main')).version,request_id:request()});
 assert.equal((await f.w[0].list({scope:'main'})).documents.length,2);
}finally{f.close();}});

test('merge requests summarize only changed documents and include removed document metadata',async()=>{const f=setup();try{
 const {b,d}=await draft(f.w[0]),m=await submit(f.w[0],b,d);
 for(const w of f.w.slice(0,3))await vote(w,m);
 const branch=await f.w[0].createBranch({name:'删除候选',visibility:'members',request_id:request()});
 await f.w[0].remove({branch_id:branch.id,expected_version:branch.version,document_id:d.id,message:'删除测试',request_id:request()});
 const current=await f.w[0].branch(branch.id);
 const candidate=await f.w[0].propose({branch_id:branch.id,expected_version:current.version,title:'审核删除',reason:'测试依据',request_id:request()});
 const review=await f.w[1].mergeRequest(candidate.id);
 assert.deepEqual(review.changes.map(change=>[change.document_id,change.title,change.tags[0].name,change.deleted]),[[d.id,'私人草稿','知性',true]]);
}finally{f.close();}});

test('legacy bundles cannot be voted on or merged and can be resubmitted as individual additions and removals',async()=>{const f=setup();try{
 const [writer,reader]=f.w;
 const initial=await draft(writer,'将移除的文档'),published=await submit(writer,initial.b,initial.d);
 for(const w of f.w.slice(0,3))await vote(w,published);
 const branch=await writer.createBranch({name:'旧批量审核',visibility:'members',request_id:request()});
 const added=await writer.save({branch_id:branch.id,expected_version:1,title:'单独新增的文档',body:'独立的改动。',category:'知性',message:'新增文档',request_id:request()});
 await writer.remove({branch_id:branch.id,expected_version:added.version,document_id:initial.d.id,message:'移除旧文档',request_id:request()});
 const current=await writer.branch(branch.id);
 const proposal={branch_id:branch.id,expected_version:current.version,title:current.name,reason:'整批审核',request_id:request()};
 await assert.rejects(writer.propose(proposal),e=>e.code==='SINGLE_DOCUMENT_REVIEW_REQUIRED');
 const bundle=legacyMerge(f,current,3);
 const summary=await reader.mergeRequest(bundle.id);
 assert.deepEqual(Object.fromEntries(summary.changes.map(change=>[change.document_id,change.deleted])),{[added.id]:false,[initial.d.id]:true});
 await assert.rejects(vote(f.w[3],bundle),e=>e.code==='SINGLE_DOCUMENT_REVIEW_REQUIRED');
 await assert.rejects(writer.accept({...bundle,main_version:2,request_id:request()}),e=>e.code==='SINGLE_DOCUMENT_REVIEW_REQUIRED');
 await assert.rejects(writer.propose(proposal),e=>e.code==='SINGLE_DOCUMENT_REVIEW_REQUIRED');
 assert.deepEqual((await reader.list({scope:'public'})).documents,[]);
 assert.equal((await reader.qualified()).some(merge=>merge.id===bundle.id),false);

 const deleted=(await writer.diff(current.id)).changes.find(change=>change.proposed.deleted);
 const addition=await submit(writer,current,added);
 const removal=await submit(writer,current,{id:deleted.document_id,version_id:deleted.proposed.id});
 assert.equal((await submit(writer,current,added)).id,addition.id);
 assert.equal((await reader.mergeRequest(removal.id)).changes[0].deleted,true);
 assert.equal((await reader.mergeRequest(addition.id)).approval_count,0);
 assert.equal((await reader.mergeRequest(removal.id)).approval_count,0);
 assert.deepEqual((await reader.list({scope:'public'})).documents.map(v=>v.branch_id),[addition.branch_id]);

 for(const w of f.w.slice(0,3))await vote(w,removal);
 await assert.rejects(reader.get('main',initial.d.id),e=>e.code==='NOT_FOUND');
 assert.equal((await reader.mergeRequest(addition.id)).state,'open');
 for(const w of f.w.slice(0,3))await vote(w,addition);
 assert.equal((await reader.get('main',added.id)).document.id,added.version_id);
 assert.equal((await reader.mergeRequest(bundle.id)).approval_count,3);
}finally{f.close();}});

test('an entirely withdrawn new draft cannot be submitted and does not bundle another document',async()=>{const f=setup();try{
 const [writer]=f.w,{b,d}=await draft(writer);
 const added=await writer.save({branch_id:b.id,expected_version:b.version,title:'准备撤回',body:'先写后撤回。',category:'知性',message:'准备草稿',request_id:request()});
 await writer.remove({branch_id:b.id,expected_version:added.version,document_id:added.id,message:'撤回新增',request_id:request()});
 const current=await writer.branch(b.id);
 await assert.rejects(writer.document(b.id,added.id),e=>e.code==='NOT_FOUND');
 const removedVersion=f.sqlite.prepare('SELECT version_id FROM kw_items WHERE branch_id=? AND document_id=?').get(b.id,added.id).version_id;
 await assert.rejects(submit(writer,current,{id:added.id,version_id:removedVersion}),e=>e.code==='NO_CHANGES');
 await writer.shareBranch({branch_id:b.id,expected_version:current.version,request_id:request()});
 const review=await writer.propose({branch_id:b.id,expected_version:current.version+1,title:'审核实际改动',reason:'逐篇认可',request_id:request()});
 assert.deepEqual((await writer.mergeRequest(review.id)).changes.map(change=>change.document_id),[d.id]);
 for(const w of f.w.slice(0,3))await vote(w,review);
 await writer.accept({id:review.id,head_id:review.head_id,main_version:1,request_id:request()});
 assert.equal((await writer.get('main',d.id)).document.id,d.version_id);
}finally{f.close();}});

test('deadline migration gives old open ballots seven days and preserves qualified and closed history',async()=>{const f=setup({through:'0005_document_tags.sql'});try{
 const original='2026-10-01T00:00:00.000Z';
 const pending=legacyMerge(f,seedLegacyBranch(f,'待认可旧提案',original),1,'open',original);
 const qualified=legacyMerge(f,seedLegacyBranch(f,'旧提案已达标',original),3,'open',original);
 const historical=legacyMerge(f,seedLegacyBranch(f,'已关闭旧提案',original),1,'closed',original);
 const sqliteNow=()=>Date.parse(f.sqlite.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') at").get().at);
 const before=sqliteNow();
 applyMigration(f.sqlite,'0006_review_deadlines.sql');
 const after=sqliteNow();
 applyMigrationsAfter(f.sqlite,'0006_review_deadlines.sql');
 const migrated=await f.w[0].mergeRequest(pending.id),deadline=Date.parse(migrated.expires_at);
 assert.ok(deadline>=before+week&&deadline<=after+week);
 assert.equal(migrated.approval_count,1);
 assert.equal((await f.w[0].mergeRequest(qualified.id)).expires_at,migrated.expires_at);
 assert.equal((await f.w[0].mergeRequest(historical.id)).expires_at,null);
 f.advance(deadline-Date.parse(f.clock())-1);
 await vote(f.w[1],pending);
 f.advance(1);
 await assert.rejects(vote(f.w[2],pending),e=>e.code==='REVIEW_DEADLINE_PASSED');
 assert.equal((await f.w[0].mergeRequest(pending.id)).expired,true);
 assert.equal((await f.w[0].mergeRequest(qualified.id)).expired,false);
 await f.w[0].accept({...qualified,main_version:1,request_id:request()});
 assert.equal((await f.w[0].mergeRequest(qualified.id)).approval_count,3);
 assert.equal((await f.w[0].mergeRequest(qualified.id)).state,'merged');
 assert.equal((await f.w[0].list({})).documents[0].title,'旧提案已达标');
}finally{f.close();}});

test('open ballots written by an older worker during rollout still have a seven-day deadline',async()=>{const f=setup();try{
 const {b}=await draft(f.w[0]);await f.w[0].shareBranch({branch_id:b.id,expected_version:b.version,request_id:request()});
 const m=legacyMerge(f,await f.w[0].branch(b.id));
 assert.equal(Date.parse((await f.w[0].mergeRequest(m.id)).expires_at)-Date.parse(f.clock()),week);
 f.advance(week);
 await assert.rejects(vote(f.w[0],m),e=>e.code==='REVIEW_DEADLINE_PASSED');
}finally{f.close();}});

test('MCP edits preserve hidden private tags without allowing clients to bind guessed names',async()=>{const f=setup({through:'0005_document_tags.sql'});try{
 const [writer]=f.w,agent=new KnowledgeWorkspace(f.db,f.actors[0],f.clock,false);
 const oldTag=request(),oldName='旧私稿中的隐式词语';
 f.sqlite.prepare('INSERT INTO kw_categories(id,name,updated_at) VALUES(?,?,?)').run(oldTag,oldName,f.clock());
 const legacy=seedLegacyBranch(f,'旧私人草稿',f.clock(),{visibility:'private',categoryId:oldTag});
 applyMigration(f.sqlite,'0006_review_deadlines.sql');
 applyMigrationsAfter(f.sqlite,'0006_review_deadlines.sql');

 assert.equal((await writer.category(legacy.id,oldTag)).pending,1);
 assert.deepEqual((await agent.categories(legacy.id)).categories,[]);
 assert.deepEqual((await agent.list({scope:'drafts',category_id:oldTag})).documents,[]);
 assert.deepEqual((await writer.tagProposals()).proposals,[]);
 const edit={branch_id:legacy.id,document_id:legacy.document,expected_version:1,title:'改旧稿',body:'补上正文。',message:'正文修改'};
 const revised=await agent.save({...edit,request_id:request()});
 assert.equal((await agent.get(legacy.id,legacy.document)).document.category_id,null);
 assert.equal((await writer.get(legacy.id,legacy.document)).document.category_id,oldTag);

 const approved=await writer.editCategory({name:'已认可词义',request_id:request()});
 for(const member of f.w.slice(0,3))await member.approveTag({id:approved.proposal_id,request_id:request()});
 const isolated=await writer.createBranch({name:'另一份私人草稿',visibility:'private',request_id:request()});
 await writer.save({branch_id:isolated.id,expected_version:1,title:'另一个文档',body:'另一个标签。',message:'初稿',category:'新私稿的隐式词语',request_id:request()});
 const create={branch_id:legacy.id,expected_version:revised.version,title:'新文档',body:'准备内容。',message:'新增文档'};
 for(const category of [oldName,'新私稿的隐式词语','不存在的词义']){
  await assert.rejects(agent.save({...create,category,request_id:request()}),e=>e.code==='TAG_NOT_FOUND');
  await assert.rejects(agent.save({...create,additional_tags:[category],request_id:request()}),e=>e.code==='TAG_NOT_FOUND');
 }
 await assert.rejects(agent.editCategory({branch_id:legacy.id,id:oldTag,name:'未授权重命名',expected_version:1,request_id:request()}),e=>e.code==='NOT_FOUND');
 const final=await agent.save({...edit,expected_version:revised.version,category:'已认可词义',additional_tags:[],request_id:request()});
 assert.equal((await writer.get(legacy.id,legacy.document)).document.id,final.version_id);
 assert.deepEqual((await writer.get(legacy.id,legacy.document)).document.tags.map(tag=>tag.id),[approved.id,oldTag]);
 assert.deepEqual((await agent.get(legacy.id,legacy.document)).document.tags.map(tag=>tag.id),[approved.id]);
}finally{f.close();}});

test('editing a public review invalidates its likes and stale draft submission is rejected',async()=>{const f=setup();try{
 const {b,d}=await draft(f.w[0]),m=await submit(f.w[0],b,d);await vote(f.w[0],m);await vote(f.w[1],m);
 f.advance(1000);
 const publicBranch=await f.w[0].branch(m.branch_id);await f.w[0].save({branch_id:publicBranch.id,expected_version:publicBranch.version,document_id:d.id,title:'修订',body:'改写后需重新认可。',category:'知性',message:'修订',request_id:request()});
 await assert.rejects(vote(f.w[2],m),e=>e.code==='STALE_PROPOSAL');assert.equal((await f.w[0].list({})).documents.length,0);
 await assert.rejects(f.w[0].submitReview({branch_id:b.id,expected_version:b.version,document_id:d.id,version_id:'wrong-version',request_id:request()}),e=>e.code==='CONFLICT');
 const current=await f.w[0].branch(publicBranch.id);
 const revised=await f.w[0].propose({branch_id:current.id,expected_version:current.version,title:'修订提案',reason:'补充说明',request_id:request()});
 assert.notEqual(revised.head_id,m.head_id);
 assert.equal(Date.parse(revised.expires_at)-Date.parse(f.clock()),week);
 assert.equal((await f.w[0].mergeRequest(revised.id)).approval_count,0);
 assert.deepEqual((await f.w[0].list({scope:'drafts'})).documents.map(v=>v.id),[d.version_id]);
 assert.notEqual((await submit(f.w[0],b,d)).id,revised.id);
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
 for(const w of f.w.slice(0,3)) await w.approveTag({id:c.proposal_id,request_id:request()});
 const adopted=await f.w[0].category('main',c.id);
 const quote='表达需求的方式。',a=await f.w[1].comment({category_id:c.id,version_id:adopted.definition_version_id,quote,start_offset:0,end_offset:quote.length,body:'是否也包括协调方式？',request_id:request()});
 const reply=await f.w[2].comment({category_id:c.id,parent_id:a.id,body:'可以结合工作实例讨论。',request_id:request()});
 assert.equal((await f.w[0].comments({category_id:c.id})).comments.find(x=>x.id===reply.id).quote,quote);
 const issue=await f.w[1].issueFromComment({comment_id:a.id,title:'讨论组织分类解释',body:'结合实际协作澄清边界。',request_id:request()});
 const updated=await f.w[0].editCategory({id:c.id,expected_version:adopted.version,name:'组织协作',definition:'共同协调活动的规则。',request_id:request()});
 for(const w of f.w.slice(0,2)) await w.approveTag({id:updated.proposal_id,request_id:request()});
 assert.equal((await f.w[1].category('main',c.id)).name,'组织');
 await f.w[2].approveTag({id:updated.proposal_id,request_id:request()});
 const after=(await f.w[1].categories()).categories[0],comment=(await f.w[0].comments({category_id:c.id})).comments.find(x=>x.id===a.id);
 assert.equal(after.name,'组织协作');assert.equal(after.version,adopted.version+1);assert.equal(locateAnnotation(after.definition,comment,after.definition_version_id),null);assert.equal((await f.w[0].version(adopted.definition_version_id)).body,definition);
 assert.equal(JSON.parse((await f.w[0].issue(issue.id)).source_json).quote,quote);assert.equal((await f.w[0].issue(issue.id)).category_id,c.id);
 await assert.rejects(f.w[0].editCategory({id:c.id,expected_version:1,name:'过期修改',definition:'不能覆盖',request_id:request()}),e=>e.code==='CONFLICT');
 await assert.rejects(f.w[0].comment({category_id:c.id,version_id:adopted.definition_version_id,quote,start_offset:0,end_offset:quote.length,body:'过期引用',request_id:request()}),e=>e.code==='QUOTE_CHANGED');
 assert.equal(f.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
}finally{f.close();}});

test('private annotations cannot be exposed through public issues or shared category discussion',async()=>{const f=setup();try{
 const {b,d}=await draft(f.w[0]),quote='需要具体依据。',c=await f.w[0].comment({branch_id:b.id,document_id:d.id,version_id:d.version_id,quote,start_offset:0,end_offset:quote.length,body:'私人批注',request_id:request()});
 await assert.rejects(f.w[0].issueFromComment({comment_id:c.id,title:'公开问题',body:'不可偷带私稿',request_id:request()}),e=>e.code==='PRIVATE_SOURCE');
 await assert.rejects(f.w[1].issueFromComment({comment_id:c.id,title:'越权',body:'不可读取',request_id:request()}),e=>e.code==='NOT_FOUND');
 const category=(await f.w[0].categories(b.id)).categories[0];await assert.rejects(f.w[0].defineCategory({id:category.id,branch_id:b.id,expected_version:1,definition:'私人类别说明。',request_id:request()}),e=>e.code==='PRIVATE_SOURCE');
 await f.w[0].comment({branch_id:b.id,category_id:category.id,body:'私人类别留言',request_id:request()});assert.equal((await f.w[1].categories()).categories.length,0);
 await submit(f.w[0],b,d);const publicBranch=(await f.w[1].list({scope:'public'})).documents[0].branch_id;
 assert.equal((await f.w[1].comments({branch_id:publicBranch,category_id:category.id})).comments.length,0);
}finally{f.close();}});
