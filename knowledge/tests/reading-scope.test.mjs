import test from 'node:test';
import assert from 'node:assert/strict';
import {KnowledgeWorkspace} from '../src/workspace.ts';
import {connectedFixture, connectMcp} from './connected-fixture.mjs';
import {request} from './fixture.mjs';

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
