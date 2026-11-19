import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request } from './fixture.mjs';
import { KnowledgeWorkspace } from '../src/workspace.ts';

function setup() {
  const f = fixture();
  const members = f.actors.map(actor => new KnowledgeWorkspace(f.db, actor, f.clock));
  const guest = new KnowledgeWorkspace(f.db, {kind: 'guest', id: request(), name: '接收者', eligible: false}, f.clock);
  return {...f, members, guest};
}

function save(writer, branch, expectedVersion, options = {}) {
  return writer.save({
    branch_id: branch.id, expected_version: expectedVersion,
    title: '审核文档', body: '原句需要核对。', message: '保存修改',
    request_id: request(), ...options,
  });
}

function submit(writer, branch, document) {
  return writer.submitReview({
    branch_id: branch.id, expected_version: document.version, document_id: document.id,
    version_id: document.version_id, reason: '交给成员核对', request_id: request(),
  });
}

function reviewTarget(review, documentId) {
  return {branch_id: review.branch_id, document_id: documentId, review_id: review.id, head_id: review.head_id};
}

function comment(writer, target, body, options = {}) {
  return writer.comment({...target, body, request_id: request(), ...options});
}

test('activity keeps same-document candidates and source drafts separate and attaches accepted history to main', async () => {
  const f = setup();
  try {
    const [writer, reviewer, second, third] = f.members;
    const source = await writer.createBranch({name: '私人草稿', visibility: 'private', request_id: request()});
    const draft = await save(writer, source, 1, {message: '仅作者可见的修改'});
    const privateTarget = {branch_id: source.id, document_id: draft.id};
    const privateComment = await comment(writer, privateTarget, '仅作者可见的评论');
    await comment(writer, privateTarget, '仅作者可见的批注', {
      version_id: draft.version_id, quote: '原句', start_offset: 0, end_offset: 2,
    });
    const sibling = await save(writer, source, draft.version, {title: '另一篇私人草稿', message: '另一篇私稿的修改'});
    await assert.rejects(reviewer.documentActivity(privateTarget), error => error.code === 'NOT_FOUND');
    const own = await writer.documentActivity(privateTarget);
    assert.deepEqual(own.entries.map(e => e.body).sort(), ['仅作者可见的修改', '仅作者可见的评论'].sort());

    f.advance(1000);
    const first = await submit(writer, source, {...draft, version: sibling.version});
    const target = reviewTarget(first, draft.id);
    const initial = await reviewer.documentActivity(target);
    assert.deepEqual(initial.entries.map(e => [e.kind, e.body]), [['submission', '交给成员核对']]);
    assert.equal(initial.entries[0].author_id, f.actors[0].id);
    assert.equal(initial.entries[0].created_at, f.clock());
    assert.deepEqual((await reviewer.comments({...target, annotations: true})).comments, []);
    await assert.rejects(reviewer.documentActivity({...target, document_id: sibling.id}), error => error.code === 'NOT_FOUND');
    await assert.rejects(reviewer.commitDetail(target.branch_id, draft.commit_id, draft.id), error => error.code === 'NOT_FOUND');
    await assert.rejects(f.guest.documentActivity(target), error => error.code === 'NOT_FOUND');

    const commentRequest = request();
    const original = await comment(reviewer, target, '只讨论第一版候选', {request_id: commentRequest});
    assert.deepEqual(await comment(reviewer, target, '只讨论第一版候选', {request_id: commentRequest}), original);
    await comment(second, target, '回复第一版候选', {parent_id: original.id});
    const annotation = await comment(reviewer, target, '公开候选的原文批注', {
      version_id: draft.version_id, quote: '原句', start_offset: 0, end_offset: 2,
    });
    const annotations = await reviewer.comments({...target, annotations: true});
    assert.deepEqual(annotations.comments.map(c => [c.id, c.version_id, c.quote]), [[annotation.id, draft.version_id, '原句']]);

    f.advance(1000);
    const otherVersion = await save(writer, source, sibling.version, {document_id: draft.id, body: '另一种候选正文。'});
    const alternative = await submit(writer, source, otherVersion);
    const alternativeTarget = reviewTarget(alternative, draft.id);
    const otherComment = await comment(third, alternativeTarget, '只讨论另一版候选');
    await third.approve({id: alternative.id, head_id: alternative.head_id, request_id: request()});
    await assert.rejects(comment(second, alternativeTarget, '越过候选回复', {parent_id: original.id}), error => error.code === 'PARENT_MISMATCH');
    assert.deepEqual((await reviewer.documentActivity(alternativeTarget)).entries.filter(e => e.kind === 'comment').map(e => e.body), ['只讨论另一版候选']);
    assert.deepEqual((await reviewer.comments({...alternativeTarget, annotations: true})).comments, []);

    for (const actor of [writer, reviewer, second]) {
      f.advance(1000);
      await actor.approve({id: first.id, head_id: first.head_id, request_id: request()});
    }
    f.advance(1000);
    const merge = await third.accept({
      id: first.id, head_id: first.head_id, main_version: (await third.branch('main')).version, request_id: request(),
    });
    const activity = (await reviewer.documentActivity(target)).entries;
    assert.deepEqual(activity.filter(e => e.kind === 'approval').map(e => e.author_id), f.actors.slice(0, 3).reverse().map(a => a.id));
    assert.equal(activity.find(e => e.kind === 'merge').commit_id, merge.commit_id);
    assert.equal(activity.filter(e => e.kind === 'comment').find(e => e.body === '回复第一版候选').parent_author_name, f.actors[1].name);
    assert.ok(!JSON.stringify(activity).includes('另一版候选'));

    const main = {branch_id: 'main', document_id: draft.id};
    await comment(writer, main, '只在已入库文档留言');
    const published = (await reviewer.documentActivity(main)).entries;
    assert.equal(published.filter(e => e.kind === 'approval').length, 3);
    assert.equal(published.find(e => e.kind === 'submission').commit_id, first.head_id);
    assert.equal(published.find(e => e.kind === 'merge').author_id, f.actors[3].id);
    assert.deepEqual(published.filter(e => e.kind === 'comment').map(e => e.body).sort(),
      ['只讨论第一版候选', '回复第一版候选', '只在已入库文档留言'].sort());
    assert.deepEqual((await reviewer.comments({...main, annotations: true})).comments.map(c => c.id), [annotation.id]);
    assert.deepEqual((await f.guest.comments({...main, annotations: true})).comments, []);
    await assert.rejects(comment(writer, main, '越过可见范围', {parent_id: privateComment.id}), error => error.code === 'PARENT_MISMATCH');
    await assert.rejects(comment(writer, main, '越过可见范围', {parent_id: otherComment.id}), error => error.code === 'PARENT_MISMATCH');
    const afterMerge = await comment(writer, main, '入库后继续这条讨论', {parent_id: original.id});
    assert.ok((await reviewer.documentActivity(target)).entries.some(e => e.kind === 'comment' && e.comment_id === afterMerge.id));
    const annotationReply = await comment(writer, main, '入库后回复同一原句', {parent_id: annotation.id});
    const stored = (await reviewer.comments({...main, annotations: true})).comments.find(c => c.id === annotationReply.id);
    assert.deepEqual([stored.branch_id, stored.version_id, stored.parent_id, stored.quote],
      [target.branch_id, draft.version_id, annotation.id, '原句']);
    assert.deepEqual((await f.guest.documentActivity(main)).entries.map(e => e.kind).sort(), ['comment', 'merge']);
    assert.deepEqual((await reviewer.commitDetail('main', merge.commit_id, draft.id)).changes.map(c => c.after.id), [draft.version_id]);
    await assert.rejects(reviewer.commitDetail('main', merge.commit_id, otherVersion.version_id), error => error.code === 'NOT_FOUND');

    const mergedBranch = await writer.branch(target.branch_id);
    await writer.deleteBranch({branch_id: mergedBranch.id, expected_version: mergedBranch.version, request_id: request()});
    await assert.rejects(reviewer.documentActivity(target), error => error.code === 'NOT_FOUND');
    const afterClose = await comment(reviewer, main, '仍保留已采纳的讨论', {parent_id: original.id});
    assert.ok((await writer.documentActivity(main)).entries.some(e => e.kind === 'comment' && e.comment_id === afterClose.id));
  } finally {
    f.close();
  }
});

test('changing the head of a public branch preserves ordinary discussion but excludes old versions from the new review', async () => {
  const f = setup();
  try {
    const [writer, reviewer] = f.members;
    const branch = await writer.createBranch({name: '公共编辑', visibility: 'members', request_id: request()});
    const one = await save(writer, branch, 1);
    const propose = expected_version => writer.propose({
      branch_id: branch.id, expected_version, title: '候选版本', reason: '请审核', request_id: request(),
    });
    const review = await propose(one.version);
    const target = reviewTarget({...review, branch_id: branch.id}, one.id);
    const before = await comment(reviewer, target, '旧候选留言');
    await reviewer.approve({id: review.id, head_id: review.head_id, request_id: request()});

    f.advance(1000);
    const two = await save(writer, branch, one.version, {document_id: one.id, body: '更新后的原句。'});
    await assert.rejects(reviewer.documentActivity(target), error => error.code === 'NOT_FOUND');
    await assert.rejects(comment(reviewer, target, '旧页面迟到提交'), error => error.code === 'NOT_FOUND');
    f.advance(1000);
    const rereview = await propose(two.version);
    const updated = {...target, head_id: rereview.head_id};
    assert.equal(rereview.id, review.id);
    assert.equal((await reviewer.documentActivity(updated)).entries.some(e => ['comment', 'approval'].includes(e.kind)), false);
    assert.equal((await reviewer.documentActivity(updated)).entries.find(e => e.kind === 'submission').created_at, f.clock());
    await assert.rejects(comment(reviewer, updated, '不能回复旧版', {parent_id: before.id}), error => error.code === 'PARENT_MISMATCH');
    const all = await reviewer.documentActivity({branch_id: branch.id, document_id: one.id});
    assert.equal(all.entries.find(e => e.kind === 'comment').body, '旧候选留言');
  } finally {
    f.close();
  }
});

test('document activity pages through equal timestamps without duplicating after a new comment', async () => {
  const f = setup();
  try {
    const [writer] = f.members;
    const branch = await writer.createBranch({name: '翻页分支', request_id: request()});
    const doc = await save(writer, branch, 1);
    const target = {branch_id: branch.id, document_id: doc.id};
    for (let i = 0; i < 58; i++) await comment(writer, target, '留言 ' + i);
    const first = await writer.documentActivity(target);
    assert.equal(first.entries.length, 40);
    assert.ok(first.next_cursor);
    f.advance(1000);
    await comment(writer, target, '翻页中到达的新留言');
    const rest = await writer.documentActivity(target, first.next_cursor);
    assert.equal(rest.next_cursor, null);
    const seen = [...first.entries, ...rest.entries];
    assert.equal(seen.length, 59);
    assert.equal(new Set(seen.map(e => e.id)).size, seen.length);
    assert.ok(!seen.some(e => e.body === '翻页中到达的新留言'));
    await assert.rejects(writer.documentActivity(target, '无效位置'), error => error.code === 'INVALID_CURSOR');
  } finally {
    f.close();
  }
});
