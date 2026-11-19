import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {selectKnowledgeText} from './verify-knowledge-annotations.mjs';

const tagReviewRow = (page, name) => page.getByRole('region', {name:'标签待认可',exact:true}).getByRole('button', {name});
const reviewDetail = page => page.getByRole('region', {name:'知识库内容',exact:true}).locator('.kb-review-detail');
const approveTag = detail => detail.getByRole('button', {name:'认可此标签',exact:true});
const approveDocument = detail => detail.getByRole('button', {name:'认可此版本',exact:true});

async function openFilter(page) {
  await page.getByRole('button',{name:'标签筛选',exact:true}).click();
  return page.getByRole('dialog',{name:'标签筛选',exact:true});
}
async function inspectTag(page,name) {
  const filter=await openFilter(page);
  await filter.getByLabel('查找已有词义').fill(name);
  await filter.locator('.tag-choice-list article').filter({hasText:name}).getByRole('button',{name:'查看与维护'}).click();
  return page.getByRole('dialog',{name:name+'标签定义与留言',exact:true});
}
async function openForm(page) {
  const filter=await openFilter(page);
  await filter.getByRole('button',{name:/新建标签/}).click();
  const form=page.getByRole('dialog',{name:'标签库',exact:true});
  if (!await form.getByLabel('标签名称').isVisible()) await form.getByRole('button',{name:/没有适用词义/}).click();
  return form;
}
async function fillTag(form,name,definition) {
  await form.getByLabel('标签名称').fill(name);
  await form.getByLabel('标签解释').fill(definition);
}
async function readTagReview(page, name, state='待认可') {
  const detail=reviewDetail(page);
  await detail.locator('.kb-review-title').getByRole('heading', {name,exact:true}).waitFor();
  await detail.locator('.kb-review-state').getByText(state, {exact:true}).waitFor();
  await detail.getByRole('region', {name:'标签认可',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await approveDocument(detail).count(),0);
  return detail;
}

async function openTagReview(page, name) {
  const row=tagReviewRow(page,name);
  await row.waitFor();
  assert.match(await row.getAttribute('class'),/\bkb-entry\b/);
  assert.equal(await row.locator('.kb-index-row-main').count(),1);
  await row.click();
  await page.waitForURL(url=>url.searchParams.has('tagProposal'));
  return readTagReview(page,name);
}

async function checkTagVote(detail, count) {
  await detail.getByLabel(`${count} / 3 人认可`, {exact:true}).waitFor();
  await detail.getByText('我已认可', {exact:true}).waitFor();
  assert.equal(await approveTag(detail).count(),0);
}

export async function verifyKnowledgeCategories(page,out,services,documentUrl) {
  const [writer,...others]=services;
  const workbench=new URL('/knowledge',documentUrl).href;
  const draftTitle='协作验收草稿';
  const tagName='协作经验',definition='协调合作的经验。明确参与者的需求。';
  const proposedName='协作方法',proposedDefinition='明确约束并协调参与者需求。';
  const before=(await writer.list({})).documents.length;
  await page.getByRole('button',{name:/新文档/}).first().click();
  const editor=page.getByRole('dialog',{name:'新文档',exact:true});
  await editor.getByLabel('标题',{exact:true}).fill(draftTitle);
  await editor.getByLabel('正文',{exact:true}).fill('从写作表单就地提议标签。');
  await editor.getByRole('button',{name:'标签',exact:true}).click();
  let form=page.getByRole('dialog',{name:'标签库',exact:true});
  await form.getByRole('button',{name:/没有适用词义/}).click();
  await fillTag(form,tagName,definition);
  await page.screenshot({path:out+'/category-editor-desktop.png',fullPage:true});
  await form.getByRole('button',{name:'提议新标签'}).click();
  await editor.locator('.kb-editor-tag-control .tag-pending').getByText('待认可',{exact:true}).waitFor();
  await editor.getByRole('button',{name:'保存草稿',exact:true}).click();
  await editor.waitFor({state:'detached'});
  const draft=(await writer.list({scope:'drafts'})).documents.find(d=>d.title===draftTitle);
  assert.equal(draft.tags[0].pending,1);
  const proposal=(await writer.tagProposals()).proposals.find(p=>p.name===tagName);
  assert.ok(proposal);

  await page.getByRole('button',{name:'提交到审核',exact:true}).click();
  await page.getByRole('dialog',{name:'提交到审核',exact:true}).getByRole('button',{name:'公开并提交审核'}).click();
  const documentReview=reviewDetail(page);
  await approveDocument(documentReview).waitFor();
  const reviewId=new URL(page.url()).searchParams.get('review');
  assert.ok(reviewId);
  const reviewBranch=(await writer.mergeRequest(reviewId)).branch_id;
  const documentRow=page.getByRole('region',{name:'待认可',exact:true}).getByRole('button',{name:draftTitle});

  let detail=await openTagReview(page,tagName);
  const tagUrl=page.url();
  const selected=new URL(tagUrl).searchParams;
  assert.equal(selected.get('tagProposal'),proposal.id);
  assert.equal(selected.has('review'),false);
  assert.equal(selected.has('document'),false);
  assert.equal(await tagReviewRow(page,tagName).getAttribute('aria-current'),'true');
  await detail.locator('.kb-review-reading').getByText(definition,{exact:true}).waitFor();
  assert.equal(await detail.locator('.kb-diff-columns').count(),0);
  assert.equal(await page.locator('.kb-tag-ballots').count(),0);
  await page.goBack();
  await documentReview.getByRole('heading',{name:draftTitle,exact:true}).waitFor();
  await documentReview.getByLabel('0 / 3 人认可',{exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('review'),reviewId);

  await page.goto(tagUrl);
  detail=await readTagReview(page,tagName);
  await detail.getByLabel('0 / 3 人认可',{exact:true}).waitFor();
  await approveTag(detail).click();
  await checkTagVote(detail,1);
  assert.equal(new URL(page.url()).searchParams.get('tagProposal'),proposal.id);
  assert.equal((await writer.mergeRequest(reviewId)).approval_count,0);
  await page.screenshot({path:out+'/tag-review-new-desktop.png',fullPage:true});

  await documentRow.click();
  await approveDocument(documentReview).click();
  await documentReview.getByLabel('1 / 3 人认可',{exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.has('tagProposal'),false);
  const voted=(await writer.tagProposals()).proposals.find(p=>p.id===proposal.id);
  assert.equal(voted.approval_count,1);
  assert.equal((await writer.mergeRequest(reviewId)).approval_count,1);
  await page.goBack();
  await checkTagVote(await readTagReview(page,tagName),1);
  for(const id of [draft.branch_id,reviewBranch]) {
    const branch=await writer.branch(id);
    await writer.deleteBranch({branch_id:id,expected_version:branch.version,request_id:randomUUID()});
  }
  for(const member of others)await member.approveTag({id:proposal.id,request_id:randomUUID()});
  await page.reload();
  detail=await readTagReview(page,tagName,'已入库');
  await detail.getByLabel('3 / 3 人认可',{exact:true}).waitFor();
  assert.equal(await approveTag(detail).count(),0);
  await tagReviewRow(page,tagName).waitFor({state:'detached'});

  await page.goto(documentUrl);
  let drawer=await inspectTag(page,tagName);
  await selectKnowledgeText(page,'协调合作的经验。');
  await page.getByRole('toolbar').getByRole('button',{name:'批注',exact:true}).click();
  await drawer.getByLabel('针对这句话写下批注…').fill('这个定义应补充协作中的约束。');
  await drawer.getByRole('button',{name:'发布批注',exact:true}).click();
  const annotation=drawer.locator('.kb-annotation').filter({hasText:'这个定义应补充协作中的约束。'});
  await annotation.click();
  assert.equal(await drawer.locator('.kb-quote.is-active').innerText(),'协调合作的经验。');
  await page.screenshot({path:out+'/category-annotation-desktop.png',fullPage:true});
  await annotation.click({button:'right'});
  await drawer.getByRole('menuitem',{name:'发起议题'}).click();
  const issue=page.getByRole('dialog',{name:'从批注发起议题'});
  await issue.getByLabel('议题标题').fill('澄清协作经验的边界');
  await issue.getByLabel('讨论内容').fill('请结合实际协作补充约束。');
  await issue.getByRole('button',{name:'发起议题',exact:true}).click();
  await issue.waitFor({state:'detached'});
  await page.waitForURL(url=>url.searchParams.get('tab')==='issues' && !!url.searchParams.get('issue'));
  const issueSource=page.locator('.kb-issues .kb-issue-source');
  await issueSource.getByText(/这个定义应补充协作中的约束/).waitFor();
  await page.reload();
  assert.match(await issueSource.innerText(),/这个定义应补充协作中的约束/);
  await page.goto(documentUrl);
  drawer=await inspectTag(page,tagName);
  await drawer.getByRole('button',{name:'编辑标签'}).click();
  const edit=page.getByRole('dialog',{name:'编辑标签',exact:true});
  await fillTag(edit,proposedName,proposedDefinition);
  await edit.getByRole('button',{name:'提交标签修改'}).click();
  await edit.waitFor({state:'detached'});
  assert.equal((await writer.category('main',proposal.category_id)).name,tagName);
  const rename=(await writer.tagProposals()).proposals.find(p=>p.name===proposedName);
  assert.ok(rename);

  detail=await readTagReview(page,proposedName);
  const renameUrl=page.url();
  assert.equal(new URL(renameUrl).searchParams.get('tagProposal'),rename.id);
  const compare=detail.locator('.kb-diff-columns');
  const current=compare.locator('.kb-review-version').filter({has:page.getByRole('heading',{name:'已入库版本',exact:true})});
  const proposed=compare.locator('.kb-proposed-version');
  await current.getByText(tagName,{exact:true}).waitFor();
  await current.getByText(definition,{exact:true}).waitFor();
  await proposed.getByRole('heading',{name:'修订版本',exact:true}).waitFor();
  await proposed.getByText(proposedName,{exact:true}).waitFor();
  await proposed.getByText(proposedDefinition,{exact:true}).waitFor();
  const currentBox=await current.boundingBox(),proposedBox=await proposed.boundingBox();
  assert.ok(currentBox.x+currentBox.width<=proposedBox.x);
  await page.screenshot({path:out+'/tag-review-comparison-desktop.png',fullPage:true});

  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    await page.goto(workbench);
    detail=await openTagReview(page,proposedName);
    await current.getByText(definition,{exact:true}).waitFor();
    await proposed.getByText(proposedDefinition,{exact:true}).waitFor();
    const voteButton=approveTag(detail);
    await voteButton.scrollIntoViewIfNeeded();
    const button=await voteButton.boundingBox();
    assert.ok(button.height>=44&&button.x>=0&&button.x+button.width<=width&&button.y+button.height<=844);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:out+`/tag-review-comparison-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'← 列表',exact:true}).click();
    await tagReviewRow(page,proposedName).waitFor();
  }
  for(const member of others)await member.approveTag({id:rename.id,request_id:randomUUID()});
  await page.goto(renameUrl);
  detail=await readTagReview(page,proposedName);
  await detail.getByLabel('2 / 3 人认可',{exact:true}).waitFor();
  await approveTag(detail).click();
  detail=await readTagReview(page,proposedName,'已入库');
  await detail.getByLabel('3 / 3 人认可',{exact:true}).waitFor();
  await page.getByRole('button',{name:'← 列表',exact:true}).click();
  await page.getByRole('searchbox',{name:'搜索知识库'}).waitFor();
  await tagReviewRow(page,proposedName).waitFor({state:'detached'});
  assert.equal(new URL(page.url()).searchParams.get('tagProposal'),rename.id);
  assert.equal((await writer.category('main',proposal.category_id)).name,proposedName);

  await page.setViewportSize({width:1440,height:1080});
  await page.goto(renameUrl);
  await readTagReview(page,proposedName,'已入库');
  await current.getByText(definition,{exact:true}).waitFor();
  await proposed.getByText(proposedDefinition,{exact:true}).waitFor();

  await page.goto(documentUrl);
  drawer=await inspectTag(page,proposedName);
  await drawer.getByText('原文已变更的批注（1）',{exact:true}).waitFor();
  await drawer.getByRole('button',{name:'关闭标签侧栏'}).click();
  assert.equal((await writer.list({})).documents.length,before);
  const stored=(await writer.issues()).issues.find(i=>i.title==='澄清协作经验的边界');
  assert.equal(JSON.parse(stored.source_json).quote,'协调合作的经验。');
  await page.setViewportSize({width:320,height:800});
  await page.goto(workbench);
  form=await openForm(page);
  await fillTag(form,'手机标签','手机上创建和选择标签。');
  await form.getByRole('button',{name:'提议新标签'}).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.screenshot({path:out+'/category-editor-mobile.png',fullPage:true});
  await form.getByRole('button',{name:'取消',exact:true}).click();
  await page.setViewportSize({width:1440,height:1080});
  await page.goto(documentUrl);
  return {independent:true,rename:true,definitionAnnotation:true,issueSource:true,oldReference:true,mobileEditor:true,ballot:true,separateVotes:true,tagReviewHistory:true,tagReviewComparison:true,tagReviewMobile:true};
}

export async function verifyKnowledgeDemo(page,out,previewUrl='http://127.0.0.1:5197/?knowledge') {
  await page.goto(previewUrl);
  await page.getByRole('button',{name:'知识库教程',exact:true}).click();
  const tutorial=page.getByRole('dialog',{name:'知识库按钮说明',exact:true});
  await tutorial.waitFor();
  await page.screenshot({path:out+'/tutorial-prototype.png',fullPage:true});
  await tutorial.getByRole('button',{name:'关闭按钮说明',exact:true}).click();
  const form=await openForm(page);
  await fillTag(form,'预览独立标签','在独立原型提交一个待认可标签。');
  await form.getByRole('button',{name:'提议新标签'}).click();
  await page.waitForURL(url=>url.searchParams.has('tagProposal'));
  const tagReview=await readTagReview(page,'预览独立标签');
  assert.equal(await tagReviewRow(page,'预览独立标签').getAttribute('aria-current'),'true');
  await tagReview.getByText('在独立原型提交一个待认可标签。',{exact:true}).waitFor();
  await approveTag(tagReview).click();
  await checkTagVote(tagReview,1);
  await page.getByRole('button',{name:/已入库/}).first().click();
  await page.getByRole('button',{name:/审核应该了解什么/}).first().click();
  await page.getByRole('button',{name:'建议修改',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'修改文档',exact:true});
  await edit.getByLabel('修改说明').fill('预览草稿审核流程');
  await edit.getByRole('button',{name:'保存草稿',exact:true}).click();
  await page.getByRole('button',{name:'提交到审核',exact:true}).click();
  const review=page.getByRole('dialog',{name:'提交到审核',exact:true});
  await review.getByRole('button',{name:'公开并提交审核'}).click();
  await page.getByRole('button',{name:'认可此版本',exact:true}).click();
  await page.getByText('我已认可',{exact:false}).first().waitFor();
  await page.screenshot({path:out+'/standalone-prototype-review.png',fullPage:true});
  await page.getByRole('button',{name:'版本协作',exact:true}).click();
  await page.getByRole('button',{name:'删除分支',exact:true}).click();
  await page.getByRole('dialog',{name:'删除分支',exact:true}).getByRole('button',{name:'确认删除',exact:true}).click();
  await page.locator('.kb-branch-choices button.active').filter({hasText:'主分支'}).waitFor();
}
