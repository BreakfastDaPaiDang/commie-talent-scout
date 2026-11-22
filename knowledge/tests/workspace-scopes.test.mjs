import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, request} from './fixture.mjs';
import {KnowledgeWorkspace} from '../src/workspace.ts';

function setup(t) {
  const f = fixture();
  t.after(() => f.close());
  return {...f, members:f.actors.map(actor => new KnowledgeWorkspace(f.db, actor, f.clock))};
}

async function writeDraft(writer, fields, source) {
  const branch = source ?? await writer.createBranch({name:'范围草稿 ' + request(), visibility:'private', request_id:request()});
  const saved = await writer.save({branch_id:branch.id, expected_version:branch.version, title:'核对材料',
    body:'先核对原始材料。', message:'保存修改', request_id:request(), ...fields});
  return {...saved, submission:{branch_id:branch.id, expected_version:saved.version, document_id:saved.id,
    version_id:saved.version_id, request_id:request()}};
}

test('private drafts remain private until their owner explicitly publishes the selected personal version', async t => {
  const f = setup(t);
  const [author, colleague] = f.members;
  const draft = await writeDraft(author, {scopes:['personal']});
  const sibling = await writeDraft(author, {title:'另一个私人草稿'}, await author.branch(draft.branch_id));
  const submission = {...draft.submission, expected_version:sibling.version, expected_publication:'direct', reason:'说明材料核对办法'};
  const personal = 'personal:' + f.actors[0].membership_id;

  assert.equal((await author.get(draft.branch_id, draft.id)).can_publish_directly, true);
  await assert.rejects(colleague.get(draft.branch_id, draft.id), error => error.code === 'NOT_FOUND');
  await assert.rejects(colleague.get('main', draft.id), error => error.code === 'NOT_FOUND');
  await author.comment({branch_id:draft.branch_id, document_id:draft.id, body:'仅自己可见的讨论', request_id:request()});

  const [published, retry] = await Promise.all([author.submitReview(submission), author.submitReview(submission)]);
  assert.deepEqual(retry, published);
  assert.deepEqual(await author.submitReview({...submission, request_id:request()}), published);
  assert.equal(published.state, 'merged');
  assert.equal(published.published_directly, true);
  assert.equal(published.branch_id, 'main');
  assert.equal(published.version_id, draft.version_id);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM kw_personal_publications').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM kw_merges').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM kw_approvals').get().n, 0);

  const {document} = await colleague.get('main', draft.id);
  assert.deepEqual(document.scopes, [personal]);
  assert.equal(document.personal_scope_name, f.actors[0].membership_name);
  assert.deepEqual((await author.list({scope:'drafts'})).documents.map(doc => doc.document_id), [sibling.id]);
  assert.deepEqual((await colleague.list({scope:'public'})).documents, []);
  assert.deepEqual((await colleague.comments({branch_id:'main', document_id:draft.id})).comments, []);
  assert.deepEqual((await colleague.history('main')).commits.map(commit => [commit.id, commit.message]), [[published.commit_id, submission.reason]]);
  await assert.rejects(colleague.commitDetail('main', draft.commit_id), error => error.code === 'NOT_FOUND');
});

test('personal revisions inherit their range, preserve historical names, and cannot overwrite a newer main version', async t => {
  const f = setup(t);
  const [author, colleague] = f.members;
  const initial = await writeDraft(author, {scopes:['personal']});
  await author.submitReview(initial.submission);
  const stale = await writeDraft(author, {document_id:initial.id, body:'另一个版本。'});
  assert.equal((await author.get(stale.branch_id, stale.id)).can_publish_directly, true);

  const renamed = new KnowledgeWorkspace(f.db, {...f.actors[0], membership_name:'更新后的档案姓名'}, f.clock);
  const edited = await writeDraft(renamed, {document_id:initial.id, scopes:['personal'], body:'更新正文。'}, await renamed.branch(initial.branch_id));
  const latest = await renamed.submitReview(edited.submission);
  assert.equal(latest.published_directly, true);
  assert.deepEqual(await renamed.submitReview({...initial.submission, request_id:request()}),
    await renamed.submitReview(initial.submission));
  assert.equal((await colleague.get('main', initial.id, initial.version_id)).document.personal_scope_name, f.actors[0].membership_name);
  assert.equal((await colleague.get('main', initial.id)).document.personal_scope_name, '更新后的档案姓名');
  assert.deepEqual((await author.get(stale.branch_id, stale.id)).document.scopes, ['personal:' + f.actors[0].membership_id]);
  assert.equal((await author.get(stale.branch_id, stale.id)).can_publish_directly, false);
  await assert.rejects(author.submitReview({...stale.submission, expected_publication:'direct'}), error => error.code === 'PUBLICATION_ROUTE_CHANGED');
  assert.equal((await colleague.get('main', initial.id)).document.id, edited.version_id);
  assert.deepEqual((await colleague.list({scope:'public'})).documents, []);
});

test('a formerly shared document keeps its old main version until three approvals of the change to personal', async t => {
  const f = setup(t);
  const [author, colleague, third] = f.members;
  const shared = await writeDraft(author, {scopes:['personal','org','hr']});
  const candidate = await author.submitReview(shared.submission);
  assert.equal(candidate.state, 'open');
  for (const member of f.members.slice(0,3)) await member.approve({id:candidate.id, head_id:candidate.head_id, request_id:request()});
  const draft = await writeDraft(author, {document_id:shared.id, scopes:['personal'], body:'改为自己的工作记录。'});
  assert.equal((await author.get(draft.branch_id, draft.id)).can_publish_directly, false);
  await assert.rejects(author.submitReview({...draft.submission, expected_publication:'direct'}), error => error.code === 'PUBLICATION_ROUTE_CHANGED');
  const review = await author.submitReview({...draft.submission, expected_publication:'review'});
  for (const member of [author, colleague]) await member.approve({id:review.id, head_id:review.head_id, request_id:request()});
  assert.equal((await colleague.get('main', shared.id)).document.id, shared.version_id);
  assert.deepEqual((await colleague.get('main', shared.id)).document.scopes, ['org','hr','personal:' + f.actors[0].membership_id]);
  assert.equal((await third.approve({id:review.id, head_id:review.head_id, request_id:request()})).merged, true);
  assert.deepEqual((await colleague.get('main', shared.id)).document.scopes, ['personal:' + f.actors[0].membership_id]);
});

test('editors cannot mint another member range and may retain an existing owner only through review', async t => {
  const f = setup(t);
  const [author, colleague] = f.members;
  const scope = 'personal:' + f.actors[0].membership_id;
  const draft = await writeDraft(author, {scopes:['personal']});
  await author.submitReview(draft.submission);
  await assert.rejects(writeDraft(colleague, {scopes:[scope]}), error => error.code === 'PERSONAL_SCOPE_OWNER_REQUIRED');

  const withoutArchiveName = new KnowledgeWorkspace(f.db, {...f.actors[0], membership_name:undefined}, f.clock);
  await assert.rejects(writeDraft(withoutArchiveName, {scopes:['personal']}), error => error.code === 'MEMBERSHIP_NAME_UNAVAILABLE');
  const preserved = await writeDraft(withoutArchiveName, {document_id:draft.id, scopes:['personal']});
  assert.equal((await author.get(preserved.branch_id, preserved.id)).document.personal_scope_name, f.actors[0].membership_name);
  const edit = await writeDraft(colleague, {document_id:draft.id, scopes:[scope], body:'共同核对意见。'});
  await assert.rejects(colleague.submitReview({...edit.submission, expected_publication:'direct'}), error => error.code === 'PUBLICATION_ROUTE_CHANGED');
  const review = await colleague.submitReview(edit.submission);
  assert.equal(review.state, 'open');
  assert.equal((await author.get(review.branch_id, edit.id)).document.personal_scope_name, f.actors[0].membership_name);
  assert.equal((await author.get('main', draft.id)).document.id, draft.version_id);
});

test('rebinding to a personal range already in review preserves the existing ballot', async t => {
  const f = setup(t);
  const [author] = f.members;
  const draft = await writeDraft(author, {scopes:['personal']});
  const rebound = new KnowledgeWorkspace(f.db, {...f.actors[0], membership_id:f.actors[1].membership_id}, f.clock);
  const candidate = await rebound.submitReview(draft.submission);
  assert.equal(candidate.state, 'open');
  assert.equal((await author.get(draft.branch_id, draft.id)).can_publish_directly, false);
  await assert.rejects(author.submitReview({...draft.submission, expected_publication:'direct', request_id:request()}),
    error => error.code === 'PUBLICATION_ROUTE_CHANGED');
  const resumed = await author.submitReview({...draft.submission, expected_publication:'review', request_id:request()});
  assert.equal(resumed.id, candidate.id);
  await assert.rejects(author.get('main', draft.id), error => error.code === 'NOT_FOUND');
});

test('explicit merge paths keep their approval checks and a deletion retains the selected ranges', async t => {
  const f = setup(t);
  const [author, colleague] = f.members;
  const draft = await writeDraft(author, {scopes:['personal']});
  const sibling = await writeDraft(author, {scopes:['org']}, await author.branch(draft.branch_id));
  const shared = await author.shareBranch({branch_id:draft.branch_id, expected_version:sibling.version, request_id:request()});
  const proposal = {branch_id:draft.branch_id, expected_version:shared.version, title:'多篇修改', reason:'确认草稿', request_id:request()};
  await assert.rejects(author.propose(proposal), error => error.code === 'SINGLE_DOCUMENT_REVIEW_REQUIRED');
  const removed = await author.remove({branch_id:draft.branch_id, expected_version:shared.version,
    document_id:sibling.id, message:'撤下其他草稿', request_id:request()});
  const candidate = await author.propose({...proposal, expected_version:removed.version, request_id:request()});
  await assert.rejects(author.submitReview({...draft.submission, expected_version:removed.version, expected_publication:'direct'}),
    error => error.code === 'PUBLICATION_ROUTE_CHANGED');
  await assert.rejects(author.accept({id:candidate.id, head_id:candidate.head_id, main_version:1, request_id:request()}),
    error => error.code === 'THREE_APPROVALS_REQUIRED');
  for (const member of f.members.slice(0,3)) await member.approve({id:candidate.id, head_id:candidate.head_id, request_id:request()});
  await author.accept({id:candidate.id, head_id:candidate.head_id, main_version:1, request_id:request()});

  const branch = await author.createBranch({name:'移除已发文档', visibility:'private', request_id:request()});
  const removal = await author.remove({branch_id:branch.id, expected_version:branch.version,
    document_id:draft.id, message:'提出移除', request_id:request()});
  const diff = await author.diff(branch.id);
  const deleted = diff.changes[0].proposed;
  assert.deepEqual(deleted.scopes, ['personal:' + f.actors[0].membership_id]);
  const review = await author.submitReview({branch_id:branch.id, expected_version:removal.version,
    document_id:draft.id, version_id:deleted.id, request_id:request()});
  assert.equal(review.state, 'open');
  assert.equal((await colleague.get('main', draft.id)).document.id, draft.version_id);
  assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
});
