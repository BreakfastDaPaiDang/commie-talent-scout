import assert from 'node:assert/strict';
import test from 'node:test';
import {emptyCatalogContent} from '../../app/shared/catalog.ts';
import {connectedFixture, connectMcp} from './connected-fixture.mjs';
import {applyMigrationsAfter, draft, fixture, request} from './fixture.mjs';
import {KnowledgeWorkspace} from '../src/workspace.ts';

function toolCall(rpc, name, args = {}) {
  return rpc('tools/call', {name, arguments: args});
}

async function read(rpc, name, args) {
  const result = await toolCall(rpc, name, args);
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent;
}

function assertReference(reference, origin, context, branchId, version, historical = false) {
  assert.equal(reference.document_id, version.id);
  assert.equal(reference.id, version.version_id);
  assert.equal(reference.version_id, version.version_id);
  assert.equal(reference.branch_id, branchId);
  assert.equal(reference.reference_context, context);
  assert.equal(reference.historical, historical);
  const url = new URL(reference.reference_url);
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, '/knowledge');
  assert.equal(url.searchParams.get('document'), version.id);
  assert.equal(url.searchParams.get('version'), version.version_id);
  assert.equal(url.hash, '');
  if (branchId === 'main') {
    assert.equal(url.searchParams.get('scope'), 'main');
    assert.equal(url.searchParams.get('branch'), null);
  } else {
    assert.equal(url.searchParams.get('branch'), branchId);
    assert.equal(url.searchParams.get('mode'), 'git');
  }
}

test('both knowledge MCPs cite exact versions and preserve publication and branch access', async t => {
  const f = await connectedFixture();
  t.after(f.close);
  const origin = f.env.IDENTITY_ORIGIN;
  const [author, ...voters] = [(await f.call('/api/identity')).body, ...f.k.actors.slice(1, 3)]
    .map(actor => new KnowledgeWorkspace(f.k.db, actor));
  const mainMcp = await connectMcp(f);
  const knowledgeMcp = await connectMcp(f, true);
  const clients = [mainMcp, knowledgeMcp];
  const title = '引用版本验收';
  const shared = await author.createBranch({name: '共享分支', request_id: request()});
  const firstEdit = await author.save({branch_id: shared.id, expected_version: shared.version,
    title, body: '只在共享分支历史中的正文。', message: '中间稿', request_id: request()});
  const published = await author.save({branch_id: shared.id, expected_version: firstEdit.version, document_id: firstEdit.id,
    title, body: '最初生效正文。', message: '确认第一版', request_id: request()});
  const firstReview = await author.propose({branch_id: shared.id, expected_version: published.version, title,
    reason: '验收只合入被选择的版本', request_id: request()});
  for (const member of [author, ...voters]) await member.approve({id: firstReview.id, head_id: firstReview.head_id, request_id: request()});
  await author.accept({id: firstReview.id, head_id: firstReview.head_id, main_version: (await author.branch('main')).version, request_id: request()});

  const privateBranch = await author.createBranch({name: '授权范围内的草稿', visibility: 'private', request_id: request()});
  const revision = await author.save({branch_id: privateBranch.id, expected_version: privateBranch.version, document_id: published.id,
    title, body: '修订后生效正文。', message: '准备修订', request_id: request()});
  for (const rpc of clients) {
    const page = await read(rpc, 'knowledge_documents', {scope: 'main'});
    const reference = page.documents[0];
    assertReference(reference, origin, 'main', 'main', published);
    assert.equal(page.next_offset, null);
    assert.equal((await read(rpc, 'knowledge_document', {id: published.id})).document.reference_url, reference.reference_url);
    const drafts = await read(rpc, 'knowledge_documents', {scope: 'drafts'});
    assertReference(drafts.documents[0], origin, 'drafts', privateBranch.id, revision);
    const draftDetail = await read(rpc, 'knowledge_document', {id: revision.id, branch_id: privateBranch.id});
    assert.equal(draftDetail.document.reference_url, drafts.documents[0].reference_url);
    for (const version_id of [firstEdit.version_id, revision.version_id, request()]) {
      const result = await toolCall(rpc, 'knowledge_document', {id: published.id, version_id});
      assert.equal(result.structuredContent.error.code, 'NOT_FOUND');
    }
  }
  await assert.rejects(voters[0].get(privateBranch.id, revision.id, revision.version_id), {code: 'NOT_FOUND'});

  const secondReview = await author.submitReview({branch_id: privateBranch.id, expected_version: revision.version,
    document_id: revision.id, version_id: revision.version_id, request_id: request()});
  for (const rpc of clients) {
    const candidates = await read(rpc, 'knowledge_documents', {scope: 'public'});
    assertReference(candidates.documents[0], origin, 'public', secondReview.branch_id, revision);
    const detail = await read(rpc, 'knowledge_document', {id: revision.id, branch_id: secondReview.branch_id, version_id: revision.version_id});
    assertReference(detail.document, origin, 'public', secondReview.branch_id, revision);
    assert.equal(detail.document.reference_url, candidates.documents[0].reference_url);
  }
  for (const member of [author, ...voters]) await member.approve({id: secondReview.id, head_id: secondReview.head_id, request_id: request()});
  for (const rpc of clients) {
    const current = (await read(rpc, 'knowledge_document', {id: published.id})).document;
    assertReference(current, origin, 'main', 'main', revision);
    const old = (await read(rpc, 'knowledge_document', {id: published.id, version_id: published.version_id})).document;
    assertReference(old, origin, 'main', 'main', published, true);
    assert.equal(old.body, '最初生效正文。');
  }

  const resource = await f.call('/api/catalog/entries', {id: request(), request_id: request(), record_kind: 'resource',
    content: {...emptyCatalogContent(), name: '引用访问验收', owner_id: f.p.actor.id}});
  assert.equal(resource.status, 200);
  const grant = await f.call('/api/catalog/grants', {id: request(), request_id: request(), entry_id: resource.body.id,
    recipient_name: '虚构接收者', receiver_id: f.p.actor.id});
  assert.equal(grant.status, 200);
  const guest = await connectMcp({...f, token: grant.body.access_key}, true);
  const guestMain = (await read(guest, 'knowledge_document', {id: published.id, version_id: published.version_id})).document;
  assertReference(guestMain, origin, 'main', 'main', published, true);
  for (const branch_id of [privateBranch.id, secondReview.branch_id]) {
    const blocked = await toolCall(guest, 'knowledge_document', {id: revision.id, branch_id, version_id: revision.version_id});
    assert.equal(blocked.structuredContent.error.code, 'NOT_FOUND');
  }
  await author.deleteBranch({branch_id: privateBranch.id, expected_version: revision.version, request_id: request()});
  const unavailable = await toolCall(knowledgeMcp, 'knowledge_document', {id: revision.id, branch_id: privateBranch.id, version_id: revision.version_id});
  assert.equal(unavailable.structuredContent.error.code, 'NOT_FOUND');
  assert.equal((await read(mainMcp, 'knowledge_document', {id: revision.id})).document.version_id, revision.version_id);
});

test('fixed version reads include the imported version of a legacy private draft', async t => {
  const f = fixture({through: '0002_production_catalog.sql'});
  t.after(f.close);
  const original = await draft(f.services[0]);
  applyMigrationsAfter(f.sqlite,'0002_production_catalog.sql');
  const owner = new KnowledgeWorkspace(f.db, f.actors[0], f.clock);
  const branchId = 'legacy-' + f.actors[0].id;
  const changed = await owner.save({branch_id: branchId, expected_version: 1, document_id: original.entry_id,
    title: '导入后更新', body: '当前草稿正文。', message: '更新旧草稿', request_id: request()});
  const exact = await owner.get(branchId, changed.id, original.id);
  assert.equal(exact.document.id, original.id);
  assert.equal(exact.historical, true);
  assert.equal(exact.reference_context, 'drafts');
  await assert.rejects(owner.get('main', changed.id, original.id), {code: 'NOT_FOUND'});
});
