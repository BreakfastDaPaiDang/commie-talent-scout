import test from 'node:test';
import assert from 'node:assert/strict';
import {KnowledgeWorkspace} from '../src/workspace.ts';
import {connectedFixture, connectMcp} from './connected-fixture.mjs';
import {request} from './fixture.mjs';
import {digest} from '../../app/server/types.ts';
import {formalActor} from '../../tests/personnel-fixture.mjs';

test('both MCP endpoints read an explicit union of approved tags from one effective library', async () => {
  const f = await connectedFixture();
  try {
    const voters = f.k.actors.slice(0, 3).map(actor => new KnowledgeWorkspace(f.k.db, actor));
    const author = voters[0];
    async function approveTag(proposal) {
      for (const voter of voters) await voter.approveTag({id: proposal.proposal_id, request_id: request()});
      return proposal.id;
    }
    async function tag(name) {
      return approveTag(await author.editCategory({name, request_id: request()}));
    }
    async function article(title, tags, state = 'adopted', documentId) {
      const branch = await author.createBranch({name: title, visibility: 'private', request_id: request()});
      const saved = await author.save({
        branch_id: branch.id, expected_version: branch.version, document_id: documentId,
        title, body: title + '的本地测试正文', category: tags[0], additional_tags: tags.slice(1),
        message: '准备一篇本地样例', request_id: request(),
      });
      if (state !== 'draft') {
        const ballot = await author.submitReview({
          branch_id: branch.id, expected_version: saved.version, document_id: saved.id,
          version_id: saved.version_id, request_id: request(),
        });
        if (state === 'adopted') {
          for (const voter of voters) await voter.approve({id: ballot.id, head_id: ballot.head_id, request_id: request()});
        }
      }
      return saved.id;
    }
    const common = await tag('通用'), hr = await tag('人事'), copy = await tag('文案');
    const empty = await tag('新设方向');
    const legacy = await tag('旧专项');
    // Implicit tags predating the ballot system used the adopted document as their public entry.
    f.k.sqlite.prepare('UPDATE kw_categories SET independent=0 WHERE id=?').run(legacy);
    const pending = await author.editCategory({name: '待认可方向', request_id: request()});
    await article('交付署名', ['通用']);
    const hrDoc = await article('审核准备', ['人事']);
    await article('稿件校对', ['文案']);
    await article('邀请作者试稿', ['人事', '文案']);
    await article('设备借用', []);
    await article('未定标签的文档', ['待认可方向']);
    await article('待投票的新方法', ['通用'], 'pending');
    await article('我的草稿', ['通用'], 'draft');
    await article('审核准备修订稿', ['文案'], 'pending', hrDoc);
    const oldArticle = await article('旧专项手册', ['旧专项']);
    await article('交付署名补充', ['通用'], 'adopted', oldArticle);
    const config = [common, hr];
    const clients = await Promise.all([connectMcp(f), connectMcp(f, true)]);
    for (const rpc of clients) {
      const read = args => rpc('tools/call', {name:'knowledge_documents', arguments:args});
      async function collect(ids) {
        let offset = 0, snapshot;
        const titles = [];
        do {
          const result = await read({scope:'main', ...(ids && {any_tag_ids:ids}), offset, limit:2});
          assert.ok(!result.isError, JSON.stringify(result));
          const page = result.structuredContent;
          if (ids) assert.deepEqual(new Set(page.categories.map(tag => tag.id)), new Set(ids));
          const revisions = [page.branch.head_id, page.tag_revision];
          if (snapshot) assert.deepEqual(snapshot, revisions);
          snapshot = revisions;
          for (const doc of page.documents) {
            assert.equal(doc.body, doc.title + '的本地测试正文');
            titles.push(doc.title);
          }
          offset = page.next_offset;
        } while (offset !== null);
        return titles.sort();
      }
      const shared = ['交付署名','交付署名补充'];
      assert.deepEqual(await collect([common, empty, legacy]), [...shared].sort());
      assert.deepEqual(await collect(config), [...shared,'审核准备','邀请作者试稿'].sort());
      assert.deepEqual(await collect([common, copy]), [...shared,'稿件校对','邀请作者试稿'].sort());
      assert.deepEqual(await collect([...config, copy, hr]), [...shared,'审核准备','稿件校对','邀请作者试稿'].sort());
      assert.deepEqual(await collect(), [...shared,'审核准备','稿件校对','邀请作者试稿','设备借用','未定标签的文档'].sort());
      for (const id of [pending.id, request()]) {
        const error = await read({any_tag_ids:[common,id]});
        assert.equal(error.structuredContent.error.code,'READING_TAG_UNAVAILABLE');
      }
      for (const args of [{any_tag_ids:[]},{scope:'public',any_tag_ids:config},{category_id:hr,any_tag_ids:config}]) {
        assert.ok((await read(args)).isError);
      }
    }
    const getReading = async () => (await clients[0]('tools/call', {
      name:'knowledge_documents', arguments:{any_tag_ids:[hr]},
    })).structuredContent;
    const before = await getReading();
    const currentTag = await author.category('main', hr);
    await approveTag(await author.editCategory({
      id: hr, expected_version: currentTag.version, name:'人事工作', request_id: request(),
    }));
    const after = await getReading();
    assert.equal(after.branch.head_id, before.branch.head_id);
    assert.notEqual(after.tag_revision, before.tag_revision);
    assert.deepEqual(after.documents.map(d => d.id), before.documents.map(d => d.id));
    assert.ok(after.documents.every(doc => doc.tags.some(t => t.id === hr && t.name === '人事工作')));
  } finally {
    await f.close();
  }
});

test('both MCP entry points apply the same per-account defaults before paging and support explicit reads', async t => {
  const f = await connectedFixture();
  t.after(f.close);
  const main = await connectMcp(f), direct = await connectMcp(f, true);
  async function addMember(name) {
    const actor = formalActor(f.p, {name});
    const token = 'scope-test-' + request();
    f.p.sqlite.prepare('UPDATE credentials SET hash=? WHERE id=?').run(await digest(token), actor.credential_id);
    return {actor, rpc: await connectMcp({...f, token}, true)};
  }
  const other = await addMember('名册里的另一位社员'), third = await addMember('第三位正式社员');
  const own = 'personal:' + f.membership, otherScope = 'personal:' + other.actor.archiveId;
  const basis = ['org', 'hr', own];
  const call = (rpc, name, arguments_ = {}) => rpc('tools/call', {name, arguments: arguments_});
  async function read(rpc, name, args) {
    const result = await call(rpc, name, args);
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent;
  }
  async function article(rpc, title, scopes, publish = true) {
    const branch = await read(rpc, 'knowledge_create_branch', {name: title, visibility: 'private', request_id: request()});
    const saved = await read(rpc, 'knowledge_save_document', {
      branch_id: branch.id, expected_version: branch.version, title, body: title + '正文', scopes,
      message: '保存测试文档', request_id: request(),
    });
    if (!publish) return saved;
    const publication = scopes?.length === 1 && scopes[0] === 'personal' ? 'direct' : 'review';
    const detail = await read(rpc, 'knowledge_document', {branch_id: branch.id, id: saved.id});
    assert.equal(detail.can_publish_directly, publication === 'direct');
    const submitted = await read(rpc, 'knowledge_submit_review', {
      branch_id: branch.id, expected_version: saved.version, document_id: saved.id, version_id: saved.version_id,
      expected_publication: publication, request_id: request(),
    });
    if (publication === 'review') {
      for (const voter of [main, other.rpc, third.rpc]) {
        await read(voter, 'knowledge_agree', {id: submitted.id, head_id: submitted.head_id, request_id: request()});
      }
    } else {
      assert.equal(submitted.published_directly, true);
      assert.equal(new URL(submitted.reference_url).searchParams.get('version'), saved.version_id);
      const original = await read(rpc, 'knowledge_document', {branch_id: branch.id, id: saved.id});
      assert.equal(original.can_publish_directly, false);
      assert.equal(original.published_directly, true);
    }
    return saved;
  }
  const shared = await article(main, '范围重叠的共用知识', ['org', 'hr', 'personal']);
  const inheritedHr = await article(main, '旧人事资料');
  const privateToAuthor = await article(main, '我的个人资料', ['personal']);
  const byOther = await article(other.rpc, '另一位社员的公开笔记', ['personal']);
  const draft = await article(main, '未发布的个人草稿', ['personal'], false);
  assert.equal(f.k.sqlite.prepare('SELECT COUNT(*) AS count FROM kw_version_scopes WHERE version_id=?').get(inheritedHr.version_id).count, 0);

  async function collect(rpc, args = {}) {
    const docs = [];
    let offset = 0, snapshot;
    do {
      const page = await read(rpc, 'knowledge_documents', {scope: 'main', ...args, offset, limit: 1});
      const current = [page.branch.head_id, page.tag_revision, page.reading_scope_ids, page.reading_defaults_version];
      if (snapshot) assert.deepEqual(current, snapshot);
      snapshot = current;
      docs.push(...page.documents);
      offset = page.next_offset;
    } while (offset !== null);
    assert.equal(new Set(docs.map(d => d.document_id)).size, docs.length);
    return {docs, snapshot};
  }
  const documentIds = docs => docs.map(d => d.document_id ?? d.id).sort();
  const defaultIds = [shared.id, inheritedHr.id, privateToAuthor.id].sort();
  const allIds = [...defaultIds, byOther.id].sort();
  for (const rpc of [main, direct]) {
    const initial = await collect(rpc);
    assert.deepEqual(documentIds(initial.docs), defaultIds);
    assert.deepEqual(initial.snapshot.slice(2), [basis, 0]);
    assert.deepEqual(initial.docs.find(d => d.document_id === inheritedHr.id).scopes, ['hr']);
    assert.deepEqual(initial.docs.find(d => d.document_id === shared.id).scopes, ['org', 'hr', own]);
    const all = await collect(rpc, {all_scopes: true});
    assert.deepEqual(documentIds(all.docs), allIds);
    assert.deepEqual(all.snapshot.slice(2), [null, null]);
    assert.deepEqual(documentIds((await collect(rpc, {search: '公开笔记'})).docs), [byOther.id]);
    const available = await read(rpc, 'knowledge_reading_scopes', {search: '另一位社员'});
    assert.deepEqual(available.scopes, [{id: otherScope, name: '名册里的另一位社员'}]);
    const requested = await collect(rpc, {scope_ids: [otherScope, 'org', otherScope]});
    assert.deepEqual(documentIds(requested.docs), [byOther.id, shared.id].sort());
    assert.deepEqual(requested.snapshot.slice(2), [[otherScope, 'org'], null]);
    const drafts = await read(rpc, 'knowledge_documents', {scope: 'drafts'});
    assert.deepEqual(documentIds(drafts.documents), [draft.id]);
    assert.equal(drafts.reading_scope_ids, null);
  }
  const browser = await f.call('/api/knowledge-workspace/documents?scope=main', undefined, {Cookie: 'cts_session=' + f.session});
  assert.equal(browser.status, 200);
  assert.equal(browser.body.reading_scope_ids, null);
  assert.deepEqual(documentIds(browser.body.documents), allIds);
  const browserFiltered = await f.call('/api/knowledge-workspace/documents?scope_ids=' + encodeURIComponent(otherScope) + '&scope_ids=org',
    undefined, {Cookie: 'cts_session=' + f.session});
  assert.deepEqual(documentIds(browserFiltered.body.documents), [byOther.id, shared.id].sort());

  const before = await read(main, 'knowledge_reading_defaults');
  assert.equal(before.identity.id, f.p.actor.id);
  assert.deepEqual(before.implicit_scope_ids, basis);
  assert.equal(before.version, 0);
  const input = {expected_version: 0, additional_scope_ids: [otherScope, own, 'org'], request_id: request()};
  const saved = await read(direct, 'knowledge_set_reading_defaults', input);
  assert.deepEqual(saved, {version: 1, additional_scope_ids: [otherScope], changed: true});
  assert.deepEqual(await read(main, 'knowledge_set_reading_defaults', input), saved);
  const stale = await call(direct, 'knowledge_set_reading_defaults', {expected_version: 0, additional_scope_ids: [], request_id: request()});
  assert.equal(stale.structuredContent.error.code, 'READING_DEFAULTS_CHANGED');
  const unavailable = await call(direct, 'knowledge_set_reading_defaults', {expected_version: 1, additional_scope_ids: ['personal:' + request()], request_id: request()});
  assert.equal(unavailable.structuredContent.error.code, 'READING_SCOPE_UNAVAILABLE');

  const anotherToken = 'scope-test-' + request(), at = new Date().toISOString();
  f.p.sqlite.prepare(`INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at)
    VALUES(?,?,?,'mcp','测试另一连接',1,?,'2099-01-01T00:00:00.000Z')`).run(request(), f.p.actor.id, await digest(anotherToken), at);
  const anotherConnection = await connectMcp({...f, token: anotherToken});
  for (const rpc of [main, direct, anotherConnection]) {
    const current = await collect(rpc);
    assert.deepEqual(documentIds(current.docs), allIds);
    assert.deepEqual(current.snapshot.slice(2), [[...basis, otherScope], 1]);
    const defaults = await read(rpc, 'knowledge_reading_defaults');
    assert.equal(defaults.identity.id, f.p.actor.id);
    assert.equal(defaults.identity.membership_id, f.membership);
    assert.deepEqual(defaults.scopes.slice(0, 2), [{id: 'org', name: '全组织通用'}, {id: 'hr', name: '人事组内'}]);
    assert.deepEqual(defaults.additional_scope_ids, [otherScope]);
    assert.deepEqual(defaults.scopes.find(scope => scope.id === otherScope), {id: otherScope, name: '名册里的另一位社员'});
  }
  assert.deepEqual((await read(other.rpc, 'knowledge_reading_defaults')).additional_scope_ids, []);

  f.p.sqlite.prepare('UPDATE archives SET linked_account_id=NULL WHERE id=?').run(f.membership);
  const rebound = formalActor(f.p, {accountId: f.p.actor.id, name: f.p.actor.name});
  const changedIdentity = await read(main, 'knowledge_reading_defaults');
  assert.deepEqual(changedIdentity.implicit_scope_ids, ['org', 'hr', 'personal:' + rebound.archiveId]);
  assert.deepEqual(changedIdentity.additional_scope_ids, [otherScope]);
  const reboundList = await collect(direct);
  assert.deepEqual(documentIds(reboundList.docs), [shared.id, inheritedHr.id, byOther.id].sort());
  const cleared = await Promise.all([main, direct].map(rpc => call(rpc, 'knowledge_set_reading_defaults', {
    expected_version: 1, additional_scope_ids: [], request_id: request(),
  })));
  assert.equal(cleared.filter(result => !result.isError).length, 1);
  assert.equal((await read(direct, 'knowledge_reading_defaults')).version, 2);
  assert.deepEqual((await read(direct, 'knowledge_reading_defaults')).additional_scope_ids, []);
});
