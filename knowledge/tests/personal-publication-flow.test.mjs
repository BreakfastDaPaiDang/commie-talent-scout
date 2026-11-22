import test from 'node:test';
import assert from 'node:assert/strict';
import {connectedFixture, connectMcp} from './connected-fixture.mjs';
import {request} from './fixture.mjs';
import {formalActor} from '../../tests/personnel-fixture.mjs';
import {digest} from '../../app/server/types.ts';

test('a public personal note joins the HR reading list only when its shared revision is adopted', async t => {
  const f = await connectedFixture();
  t.after(() => f.close());
  async function client(fixture, direct) {
    const rpc = await connectMcp(fixture, direct);
    return async (name, args = {}) => {
      const result = await rpc('tools/call', {name, arguments:args});
      assert.ok(!result.isError, JSON.stringify(result));
      return result.structuredContent;
    };
  }
  async function colleague(direct) {
    const actor = formalActor(f.p);
    const token = 'local-reader-' + request();
    f.p.sqlite.prepare('UPDATE credentials SET hash=? WHERE id=?').run(await digest(token), actor.credential_id);
    return client({...f, token}, direct);
  }
  const author = await client(f, false);
  const other = await colleague(true);
  const third = await colleague(false);
  async function submit(scopes, body, id) {
    const branch = await author('knowledge_create_branch', {name:id ? '试稿笔记共享修订' : '个人试稿笔记', visibility:'private', request_id:request()});
    const saved = await author('knowledge_save_document', {
      branch_id:branch.id, expected_version:branch.version, document_id:id, title:'试稿核对办法',
      body, scopes, message:'更新适用范围', request_id:request(),
    });
    const submission = await author('knowledge_submit_review', {branch_id:branch.id, expected_version:saved.version,
      document_id:saved.id, version_id:saved.version_id, request_id:request()});
    return {id:saved.id, version:saved.version_id, submission};
  }
  const personal = await submit(['personal'], '作者自己的试稿笔记。');
  assert.equal(personal.submission.published_directly, true);
  const own = await author('knowledge_documents');
  assert.deepEqual(own.documents.map(d => d.document_id), [personal.id]);
  assert.deepEqual(own.documents[0].scopes, ['personal:' + f.membership]);
  assert.deepEqual((await other('knowledge_documents')).documents, []);
  assert.equal((await other('knowledge_document', {id:personal.id})).document.id, personal.version);
  const mixed = await submit(['org','hr','personal'], '本次提议采用的做法。', personal.id);
  for (const vote of [author, other]) await vote('knowledge_agree', {
    id:mixed.submission.id, head_id:mixed.submission.head_id, request_id:request(),
  });
  assert.equal((await other('knowledge_document', {id:personal.id})).document.id, personal.version);
  assert.deepEqual((await other('knowledge_documents')).documents, []);
  await third('knowledge_agree', {id:mixed.submission.id, head_id:mixed.submission.head_id, request_id:request()});
  for (const read of [author, other]) {
    const {documents, next_offset} = await read('knowledge_documents', {limit:1});
    assert.deepEqual(documents.map(d => d.id), [mixed.version]);
    assert.equal(next_offset, null);
  }
  const oldReference = await other('knowledge_document', {id:personal.id, version_id:personal.version});
  assert.deepEqual(oldReference.document.scopes, ['personal:' + f.membership]);
  assert.equal(oldReference.document.historical, true);
});
