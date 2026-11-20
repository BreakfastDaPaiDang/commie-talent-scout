import assert from 'node:assert/strict';
import {connectMcp} from '../knowledge/tests/connected-fixture.mjs';
import {request} from '../knowledge/tests/fixture.mjs';

export async function verifyKnowledgeReferences(page, fixture, base, services) {
  const identityOrigin = fixture.env.IDENTITY_ORIGIN;
  const viewport = page.viewportSize();
  fixture.env.IDENTITY_ORIGIN = base;
  const writer = services[0];
  const title = '版本引用验收示例';
  const oldBody = '引用链接固定到第一版正文。';
  const newBody = '这是随后发布的修订正文。';
  async function submit(branch, version) {
    return writer.submitReview({branch_id: branch.id, expected_version: version.version, document_id: version.id,
      version_id: version.version_id, request_id: request()});
  }
  async function approve(review) {
    for (const service of services) await service.approve({id: review.id, head_id: review.head_id, request_id: request()});
  }
  async function read(rpc, name, args) {
    const result = await rpc('tools/call', {name, arguments: args});
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent;
  }
  const article = page.locator('.kb-article');
  async function open(reference, text) {
    assert.equal(new URL(reference.reference_url).origin, base);
    await page.goto(reference.reference_url);
    await article.getByRole('heading', {name: title, exact: true}).waitFor();
    await article.getByText(text, {exact: true}).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('version'), reference.version_id);
  }
  try {
    const originalBranch = await writer.createBranch({name: '引用第一版草稿', visibility: 'private', request_id: request()});
    const original = await writer.save({branch_id: originalBranch.id, expected_version: originalBranch.version, title,
      body: oldBody, message: '新建引用验收示例', request_id: request()});
    await approve(await submit(originalBranch, original));
    const main = await connectMcp(fixture);
    const independent = await connectMcp(fixture, true);
    const listed = (await read(main, 'knowledge_documents', {scope: 'main', search: title})).documents[0];
    const detail = (await read(independent, 'knowledge_document', {id: original.id})).document;
    assert.equal(listed.reference_url, detail.reference_url);
    await page.setViewportSize({width: 1440, height: 1080});
    await open(listed, oldBody);
    await article.getByText('已入库', {exact: true}).waitFor();

    const revisionBranch = await writer.createBranch({name: '引用修订草稿', visibility: 'private', request_id: request()});
    const revision = await writer.save({branch_id: revisionBranch.id, expected_version: revisionBranch.version, document_id: original.id,
      title, body: newBody, message: '修订引用示例', request_id: request()});
    const draft = (await read(independent, 'knowledge_documents', {scope: 'drafts', search: title})).documents[0];
    await open(draft, newBody);
    assert.match(await article.locator('.kb-article-meta').innerText(), /我的草稿/);
    assert.equal(await page.getByRole('button', {name: '分享文档', exact: true}).count(), 0);
    const review = await submit(revisionBranch, revision);
    const candidate = (await read(main, 'knowledge_documents', {scope: 'public', search: title})).documents[0];
    await open(candidate, newBody);
    assert.match(await article.locator('.kb-article-meta').innerText(), /公开审核/);
    await approve(review);

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({width, height: 844});
      await open(detail, oldBody);
      await article.getByText('历史版本', {exact: true}).waitFor();
      assert.equal(await article.getByText(newBody, {exact: true}).count(), 0);
      assert.equal(await article.getByRole('button', {name: '建议修改', exact: true}).count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    const current = (await read(main, 'knowledge_document', {id: original.id})).document;
    await open(current, newBody);
    assert.equal(current.version_id, revision.version_id);
    const missing = new URL(current.reference_url);
    missing.searchParams.set('version', request());
    await page.goto(missing.href);
    await page.getByRole('alert').filter({hasText: '文档版本不存在或不可见'}).waitFor();
    assert.equal(await article.count(), 0);
    return {main: true, independent: true, draft: true, candidate: true, historical: true, mobile: true};
  } finally {
    fixture.env.IDENTITY_ORIGIN = identityOrigin;
    await page.setViewportSize(viewport);
  }
}
