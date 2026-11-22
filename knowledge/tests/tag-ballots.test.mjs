import assert from 'node:assert/strict';
import test from 'node:test';
import {applyMigration,applyMigrationsAfter,fixture,request} from './fixture.mjs';
import {KnowledgeWorkspace} from '../src/workspace.ts';

test('article and tag use separate ballots, even when created together', async () => {
  const f=fixture();
  try {
    const [a,b,c]=f.actors.map(actor=>new KnowledgeWorkspace(f.db,actor,f.clock));
    const guest=new KnowledgeWorkspace(f.db,{kind:'guest',id:request(),name:'接收者',eligible:false},f.clock);
    const tag=await a.editCategory({name:'共同判断',definition:'可复用的人事共识',request_id:request()});
    const draft=await a.createBranch({name:'准备发布',visibility:'private',request_id:request()});
    const doc=await a.save({branch_id:draft.id,expected_version:draft.version,title:'周会',body:'讨论审核依据',category:'共同判断',message:'草稿',request_id:request()});
    const ballot=await a.submitReview({branch_id:draft.id,expected_version:doc.version,document_id:doc.id,version_id:doc.version_id,request_id:request()});
    for(const voter of [a,b,c]) await voter.approve({id:ballot.id,head_id:ballot.head_id,request_id:request()});
    assert.equal((await guest.get('main',doc.id)).document.tags.length,0);
    assert.equal((await a.get('main',doc.id)).document.tags[0].pending,1);
    const [pending]=(await a.tagProposals()).proposals;
    assert.deepEqual(await a.tagProposal(tag.proposal_id),pending);
    assert.equal(pending.author_id,a.actor.id);
    assert.equal(pending.created_at,f.clock());
    assert.equal(pending.state,'pending');
    assert.deepEqual(pending.approvers,[]);
    const input={id:tag.proposal_id,request_id:request()};
    assert.deepEqual(await a.approveTag(input),await a.approveTag(input));
    await a.approveTag({...input,request_id:request()});
    const alias=new KnowledgeWorkspace(f.db,{...f.actors[0],id:request()},f.clock);
    await alias.approveTag({...input,request_id:request()});
    const rebound=new KnowledgeWorkspace(f.db,{...f.actors[0],membership_id:request()},f.clock);
    await rebound.approveTag({...input,request_id:request()});
    const [once]=(await a.tagProposals()).proposals;
    assert.equal(once.approval_count,1);
    assert.equal((await alias.tagProposal(tag.proposal_id)).approved_by_me,1);
    assert.equal((await rebound.tagProposal(tag.proposal_id)).approved_by_me,1);
    assert.deepEqual(once.approvers,[{id:a.actor.id,name:a.actor.name,created_at:f.clock()}]);
    await b.approveTag({...input,request_id:request()});
    assert.equal((await guest.get('main',doc.id)).document.tags.length,0);
    assert.equal((await c.approveTag({...input,request_id:request()})).adopted,true);
    assert.equal((await guest.get('main',doc.id)).document.tags[0].id,tag.id);
    assert.equal((await a.tagProposals()).proposals.length,0);
    const adopted=await a.tagProposal(tag.proposal_id);
    assert.equal(adopted.state,'approved');
    assert.equal(adopted.pending,1);
    assert.equal(adopted.approval_count,3);
    assert.deepEqual(adopted.approvers.map(v=>v.id).sort(),[a,b,c].map(w=>w.actor.id).sort());
  } finally { f.close(); }
});

test('tag voting closes on day seven and resubmission preserves the previous votes separately', async () => {
  const f=fixture();
  try {
    const [a,b,c]=f.actors.map(actor=>new KnowledgeWorkspace(f.db,actor,f.clock));
    const tag=await a.editCategory({name:'验证方法',definition:'第一次提交',request_id:request()});
    const input={id:tag.proposal_id,request_id:request()};
    await a.approveTag(input);
    await assert.rejects(a.editCategory({id:tag.id,name:'同时改写',expected_version:1,request_id:request()}),e=>e.code==='TAG_PROPOSAL_OPEN');
    f.advance(7*86400000-1);
    await b.approveTag({...input,request_id:request()});
    f.advance(1);
    await assert.rejects(c.approveTag({...input,request_id:request()}),e=>e.code==='TAG_VOTE_CLOSED');
    assert.deepEqual((await a.tagProposals()).proposals,[]);
    const elapsed=await a.tagProposal(tag.proposal_id);
    assert.equal(elapsed.state,'expired');
    assert.equal(elapsed.approval_count,2);
    assert.equal(f.sqlite.prepare('SELECT state FROM kw_tag_proposals WHERE id=?').get(tag.proposal_id).state,'pending');
    const retry=await a.editCategory({id:tag.id,name:'验证方法',definition:'修订后重提',expected_version:1,request_id:request()});
    assert.notEqual(retry.proposal_id,tag.proposal_id);
    assert.equal((await a.tagProposals()).proposals[0].approval_count,0);
    for(const w of [a,b,c])await w.approveTag({id:retry.proposal_id,request_id:request()});
    assert.equal((await a.category('main',tag.id)).definition,'修订后重提');
    assert.equal(f.sqlite.prepare('SELECT count(*) n FROM kw_tag_votes WHERE proposal_id=?').get(tag.proposal_id).n,2);
    assert.equal(f.sqlite.prepare('SELECT state FROM kw_tag_proposals WHERE id=?').get(tag.proposal_id).state,'expired');
    const expired=await a.tagProposal(tag.proposal_id);
    assert.equal(expired.state,'expired');
    assert.equal(expired.pending,1);
    assert.deepEqual(expired.approvers,elapsed.approvers);
    f.advance(7*86400000);
    assert.equal((await a.tagProposal(retry.proposal_id)).state,'approved');
  } finally {f.close();}
});

test('adopted edits retain the original comparison after subsequent category versions',async()=>{
  const f=fixture({through:'0003_knowledge_workspace.sql'});
  try {
    const id=request();
    f.sqlite.prepare('INSERT INTO kw_categories(id,name,definition,updated_at) VALUES(?,?,?,?)').run(id,'旧标签','第一版词义',f.clock());
    applyMigration(f.sqlite,'0004_reviews_and_categories.sql');
    f.sqlite.prepare('UPDATE kw_categories SET independent=1 WHERE id=?').run(id);
    applyMigrationsAfter(f.sqlite,'0004_reviews_and_categories.sql');
    const [a,b,c]=f.actors.map(actor=>new KnowledgeWorkspace(f.db,actor,f.clock));

    async function edit(expected_version,name,definition) {
      const ballot=await a.editCategory({id,name,definition,expected_version,request_id:request()});
      for(const voter of [a,b,c]) await voter.approveTag({id:ballot.proposal_id,request_id:request()});
      return ballot.proposal_id;
    }
    const first=await edit(1,'修改标签','第二版词义');
    const second=await edit(2,'最终标签','第三版词义');
    const old=await a.tagProposal(first);
    assert.equal(old.state,'approved');
    assert.equal(old.pending,0);
    assert.deepEqual([old.current_name,old.current_definition,old.name,old.definition],['旧标签','第一版词义','修改标签','第二版词义']);
    const next=await a.tagProposal(second);
    assert.deepEqual([next.current_name,next.current_definition],['修改标签','第二版词义']);
  } finally {f.close();}
});

test('migration queues only shared demonstration tags without adopted usage and preserves all associations',()=>{
  const f=fixture({through:'0006_review_deadlines.sql'}),db=f.sqlite;
  try {
    const label=db.prepare('INSERT INTO kw_categories(id,name,definition,updated_at,independent) VALUES(?,?,?,?,?)');
    for(const [id,name,shared] of [['demo','工程',1],['adopted','运动',1],['private','技击技术',0],['regular','方法',1]]) {
      label.run(id,name,'词义',f.clock(),shared);
    }
    db.prepare('INSERT INTO kw_documents VALUES(?,?,?,?)').run('doc','a','a',f.clock());
    db.prepare('INSERT INTO kw_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('v1','doc','文档','内容','adopted','知识','',0,'a','a',f.clock());
    db.prepare('INSERT INTO kw_items VALUES(?,?,?,?)').run('main','doc','v1','v1');
    applyMigration(db,'0007_tag_proposals.sql');
    assert.deepEqual(db.prepare('SELECT category_id FROM kw_tag_proposals').all().map(r=>r.category_id),['demo']);
    const terms=Object.fromEntries(db.prepare('SELECT id,pending,independent FROM kw_categories').all().map(r=>[r.id,[r.pending,r.independent]]));
    assert.deepEqual(terms,{demo:[1,1],adopted:[0,1],private:[1,0],regular:[0,1]});
    assert.equal(db.prepare('SELECT category_id FROM kw_document_tags WHERE version_id=?').get('v1').category_id,'adopted');
    const ballot=db.prepare('SELECT created_at,expires_at FROM kw_tag_proposals').get();
    assert.equal(Date.parse(ballot.expires_at)-Date.parse(ballot.created_at),7*86400000);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {f.close();}
});
