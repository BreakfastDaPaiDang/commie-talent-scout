import assert from 'node:assert/strict';
import {request} from '../knowledge/tests/fixture.mjs';
import {memberContext} from './verify-knowledge-review.mjs';

const article = page => page.locator('.kb-article');
const ranges = owner => owner.locator('.kb-document-scopes dd');
const heading = (page, name) => article(page).getByRole('heading',{name,exact:true});
const editor = (page, name) => page.getByRole('dialog',{name,exact:true});
const option = (form, name) => form.getByRole('group',{name:'文档范围'}).getByRole('checkbox',{name,exact:true});
const saveButton = form => form.getByRole('button',{name:'保存草稿',exact:true});
const publishButton = page => page.getByRole('button',{name:'发布并入库',exact:true});
const reviewButton = page => page.getByRole('button',{name:'提交到审核',exact:true});
const selection = page => new URL(page.url()).searchParams;

async function checkLayout(page, action, {touch = false} = {}) {
  await action.scrollIntoViewIfNeeded();
  const viewport = await page.evaluate(() => ({width:innerWidth,height:innerHeight,content:document.documentElement.scrollWidth}));
  assert.ok(viewport.content <= viewport.width+1,JSON.stringify(viewport));
  const button = await action.boundingBox();
  assert.ok(button && button.x >= 0 && button.x+button.width <= viewport.width && button.y >= 0 && button.y+button.height <= viewport.height);
  if (touch) assert.ok(button.height >= 40,JSON.stringify(button));
  const overflow = await page.locator('dialog[open]').evaluateAll(dialogs => dialogs.flatMap(dialog =>
    dialog.scrollWidth <= dialog.clientWidth+1 ? [] : [{name:dialog.getAttribute('aria-label'),width:dialog.clientWidth,content:dialog.scrollWidth}]));
  assert.deepEqual(overflow,[]);
}

async function chooseTag(page, form) {
  await form.getByRole('button',{name:'标签',exact:true}).click();
  const picker = editor(page,'标签库');
  await picker.locator('.tag-choice-list article').filter({has:page.getByText('知性',{exact:true})})
    .getByRole('button',{name:'选择',exact:true}).click();
  await picker.waitFor({state:'detached'});
}

async function expectRanges(owner, names) {
  const value = ranges(owner).filter({hasText:names});
  await value.waitFor();
  assert.equal(await value.textContent(),names);
}

async function confirmPublication(page, reason, out, screenshot, {touch = false} = {}) {
  await checkLayout(page,publishButton(page),{touch});
  await publishButton(page).click();
  const confirmation = editor(page,'发布并入库');
  await confirmation.getByText(/成员可在知识库查阅.*无需投票/).waitFor();
  await confirmation.getByLabel('提交说明',{exact:false}).fill(reason);
  const submit = confirmation.getByRole('button',{name:'确认发布',exact:true});
  await checkLayout(page,submit,{touch});
  await page.screenshot({path:out+'/'+screenshot,fullPage:true});
  await submit.click();
  await confirmation.waitFor({state:'detached'});
}

export async function verifyKnowledgeDocumentScopes({page,browser,previewUrl,out,fixture,services,documentUrl}) {
  const [writer,...voters] = services;
  const base = new URL(documentUrl).origin;
  const library = base+'/knowledge';
  const {membership_name:name} = (await fixture.call('/api/identity')).body;
  assert.ok(name);
  const personal = '个人：'+name;
  const personalId = 'personal:'+fixture.membership;
  const title = '个人工作方法验收';
  const body = '先写下可验证的问题，再逐步补齐材料。\n\n## 复盘\n记录判断依据和实际结果。';

  await page.setViewportSize({width:1440,height:1080});
  await page.goto(documentUrl);
  await expectRanges(article(page),'人事组内');
  const add = page.getByRole('button',{name:'＋ 新文档',exact:true});
  await add.click();
  const create = editor(page,'新文档');
  assert.equal(await option(create,'人事组内').isChecked(),true);
  assert.equal(await option(create,'全组织通用').isChecked(),false);
  assert.equal(await option(create,personal).isChecked(),false);
  await create.getByLabel('标题',{exact:true}).fill(title);
  await create.getByLabel('正文',{exact:true}).fill(body);
  await chooseTag(page,create);
  await option(create,'人事组内').uncheck();
  await saveButton(create).click();
  await create.getByRole('alert').filter({hasText:'请至少选择一个文档范围'}).waitFor();
  await option(create,personal).focus();
  await page.keyboard.press('Space');
  assert.equal(await option(create,personal).isChecked(),true);
  await create.getByRole('button',{name:'取消',exact:true}).click();
  await add.click();
  assert.equal(await option(create,personal).isChecked(),true);
  assert.equal(await create.getByLabel('正文',{exact:true}).inputValue(),body);
  await create.getByText('来源（可选）',{exact:true}).click();
  await create.getByLabel('来源',{exact:true}).fill('已核对的验收记录');
  await checkLayout(page,saveButton(create));
  await page.screenshot({path:out+'/document-scope-editor-desktop.png',fullPage:true});
  await saveButton(create).click();
  await create.waitFor({state:'detached'});
  await heading(page,title).waitFor();
  await expectRanges(article(page),personal);
  const draftId = selection(page).get('branch');
  const documentId = selection(page).get('document');
  assert.ok(draftId && documentId);
  const draft = await writer.document(draftId,documentId);
  assert.deepEqual(draft.scopes,[personalId]);
  assert.equal(draft.personal_scope_name,name);
  assert.equal((await writer.list({scope:'main'})).documents.some(doc => doc.document_id===documentId),false);

  let dropped = false;
  const reviewRoute = '**/api/knowledge-workspace/reviews';
  await page.route(reviewRoute,async route => {
    if (route.request().method()==='POST' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  try {
    await confirmPublication(page,'首次发布工作方法',out,'personal-publication-desktop.png');
  } finally {
    await page.unroute(reviewRoute);
  }
  assert.equal(dropped,true);
  await heading(page,title).waitFor();
  await article(page).getByText('已入库',{exact:true}).waitFor();
  await expectRanges(article(page),personal);
  assert.equal(selection(page).get('document'),documentId);
  assert.equal(selection(page).has('review') || selection(page).has('branch'),false);
  assert.doesNotMatch(await article(page).innerText(),/私密|仅你可见|我的草稿/);
  assert.equal((await writer.document('main',documentId)).id,draft.id);
  await article(page).locator('.kb-activity-message').filter({hasText:'首次发布工作方法'}).waitFor();
  await article(page).getByRole('button',{name:'查看版本',exact:true}).click();
  const version = editor(page,'版本内容');
  await expectRanges(version,personal);
  await version.getByRole('button',{name:'关闭对话框',exact:true}).click();

  await page.goto(library+'?'+new URLSearchParams({branch:draftId,document:documentId}));
  await page.waitForURL(url => !url.searchParams.has('branch') && url.searchParams.get('document')===documentId);
  await article(page).getByText('已入库',{exact:true}).waitFor();

  const currentUrl = library+'?document='+documentId;
  const otherContext = await memberContext(browser,fixture,fixture.k.actors[3],base);
  try {
    const other = await otherContext.newPage();
    await other.goto(currentUrl);
    await heading(other,title).waitFor();
    await expectRanges(article(other),personal);
    await article(other).getByRole('button',{name:'分享文档',exact:true}).waitFor();
    assert.doesNotMatch(await article(other).innerText(),/私密|仅你可见/);
  } finally {
    await otherContext.close();
  }

  await page.setViewportSize({width:390,height:844});
  await page.goto(currentUrl);
  await page.getByRole('button',{name:'建议修改',exact:true}).click();
  const edit = editor(page,'修改文档');
  assert.equal(await option(edit,personal).isChecked(),true);
  assert.equal(await option(edit,'人事组内').isChecked(),false);
  const updatedBody = body+'\n\n补记：在下一轮讨论前回顾已记录的判断。';
  await edit.getByLabel('正文',{exact:true}).fill(updatedBody);
  await edit.getByText('来源（可选）',{exact:true}).click();
  await edit.getByLabel('来源',{exact:true}).fill('已完成的手机验收');
  await checkLayout(page,saveButton(edit),{touch:true});
  await page.screenshot({path:out+'/document-scope-editor-source-mobile390.png',fullPage:true});
  await edit.evaluate(dialog => {dialog.scrollTop=0;});
  await page.screenshot({path:out+'/document-scope-editor-mobile390.png',fullPage:true});
  await saveButton(edit).click();
  await edit.waitFor({state:'detached'});
  await confirmPublication(page,'更新复盘说明',out,'personal-publication-mobile390.png',{touch:true});
  await article(page).getByText('已入库',{exact:true}).waitFor();
  const revised = await writer.document('main',documentId);
  assert.equal(revised.body,updatedBody);
  assert.deepEqual(revised.scopes,[personalId]);

  await page.setViewportSize({width:320,height:844});
  await page.goto(currentUrl);
  await page.getByRole('button',{name:'建议修改',exact:true}).click();
  await option(edit,'全组织通用').check();
  await option(edit,'人事组内').check();
  assert.equal(await option(edit,personal).isChecked(),true);
  const optionBox = await option(edit,personal).locator('..').boundingBox();
  assert.ok(optionBox.height>=44);
  await checkLayout(page,saveButton(edit),{touch:true});
  await page.screenshot({path:out+'/mixed-scope-editor-mobile320.png',fullPage:true});
  await saveButton(edit).click();
  await edit.waitFor({state:'detached'});
  const combined = '全组织通用、人事组内、'+personal;
  await expectRanges(article(page),combined);
  await checkLayout(page,reviewButton(page),{touch:true});
  assert.equal(await publishButton(page).count(),0);
  await reviewButton(page).click();
  const review = editor(page,'提交到审核');
  await expectRanges(review,combined);
  await review.getByText(/获得三人同意/).waitFor();
  const submitReview = review.getByRole('button',{name:'公开并提交审核',exact:true});
  await checkLayout(page,submitReview,{touch:true});
  await page.screenshot({path:out+'/mixed-scope-review-mobile320.png',fullPage:true});
  await submitReview.click();
  await review.waitFor({state:'detached'});
  const comparison = page.locator('.kb-review-detail .kb-diff-columns');
  await expectRanges(comparison.locator('.kb-review-version').first(),personal);
  await expectRanges(comparison.locator('.kb-proposed-version'),combined);
  await page.getByLabel('0 / 3 人认可',{exact:true}).waitFor();
  await checkLayout(page,page.getByRole('button',{name:'认可此版本',exact:true}),{touch:true});
  await page.locator('.kb-detail-scroll').evaluate(detail => {detail.scrollTop=0;});
  await page.screenshot({path:out+'/scope-only-diff-mobile320.png',fullPage:true});
  const mergeId = selection(page).get('review');
  const headId = selection(page).get('head');
  assert.ok(mergeId && headId);
  assert.deepEqual((await writer.document('main',documentId)).scopes,[personalId]);
  assert.equal((await writer.document((await writer.mergeRequest(mergeId)).branch_id,documentId)).body,updatedBody);
  await page.getByRole('button',{name:'认可此版本',exact:true}).click();
  await page.getByLabel('1 / 3 人认可',{exact:true}).waitFor();
  await voters[0].approve({id:mergeId,head_id:headId,request_id:request()});
  assert.deepEqual((await writer.document('main',documentId)).scopes,[personalId]);
  await voters[1].approve({id:mergeId,head_id:headId,request_id:request()});
  await page.goto(currentUrl);
  await heading(page,title).waitFor();
  await expectRanges(article(page),combined);
  assert.deepEqual(new Set((await writer.document('main',documentId)).scopes),new Set(['org','hr',personalId]));

  const preview = await browser.newPage({viewport:{width:320,height:844},hasTouch:true});
  try {
    await preview.goto(previewUrl);
    await preview.getByRole('button',{name:'＋ 新文档',exact:true}).tap();
    const form = editor(preview,'新文档');
    assert.equal(await option(form,'人事组内').isChecked(),true);
    await form.getByLabel('标题',{exact:true}).fill('原型个人发布验收');
    await form.getByLabel('正文',{exact:true}).fill('示例正文，展示同一套表单和发布流程。');
    await chooseTag(preview,form);
    await option(form,'人事组内').uncheck();
    await option(form,'个人：示例社员').check();
    await checkLayout(preview,saveButton(form),{touch:true});
    await saveButton(form).tap();
    await confirmPublication(preview,'原型确认发布',out,'scope-publication-prototype-mobile320.png',{touch:true});
    await article(preview).getByText('已入库',{exact:true}).waitFor();
    await expectRanges(article(preview),'个人：示例社员');
  } finally {
    await preview.close();
  }

  return {desktop:true, mobile390:true, mobile320:true, prototype:true, savedScope:true, directPublication:true,
    responseRecovery:true, publishedDraftLink:true, visibleToOtherMember:true, personalRevision:true, scopeOnlyReview:true, threeVotes:true};
}
