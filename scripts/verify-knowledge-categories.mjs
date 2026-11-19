import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {selectKnowledgeText} from './verify-knowledge-annotations.mjs';

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
async function voteViaWeb(page,name) {
  const group=page.locator('.kb-tag-ballots');
  if (!await group.evaluate(node=>node.open)) await group.locator('summary').click();
  await group.getByRole('button',{name:new RegExp(name)}).click();
  await page.getByRole('button',{name:'认可此标签',exact:true}).click();
  await page.getByRole('button',{name:'认可此标签',exact:true}).waitFor({state:'detached'});
}

export async function verifyKnowledgeCategories(page,out,services,documentUrl) {
  const [writer,...others]=services;
  const before=(await writer.list({})).documents.length;
  await page.getByRole('button',{name:/新文档/}).first().click();
  const editor=page.getByRole('dialog',{name:'新文档',exact:true});
  await editor.getByLabel('标题',{exact:true}).fill('协作验收草稿');
  await editor.getByLabel('正文',{exact:true}).fill('从写作表单就地提议标签。');
  await editor.getByRole('button',{name:'标签',exact:true}).click();
  let form=page.getByRole('dialog',{name:'标签库',exact:true});
  await form.getByRole('button',{name:/没有适用词义/}).click();
  await fillTag(form,'协作经验','协调合作的经验。明确参与者的需求。');
  await page.screenshot({path:out+'/category-editor-desktop.png',fullPage:true});
  await form.getByRole('button',{name:'提议新标签'}).click();
  await editor.locator('.kb-selected-tags .tag-pending').waitFor();
  await editor.getByRole('button',{name:'保存草稿',exact:true}).click();
  await editor.waitFor({state:'detached'});
  const draft=(await writer.list({scope:'drafts'})).documents.find(d=>d.title==='协作验收草稿');
  assert.equal(draft.tags[0].pending,1);
  const source=await writer.branch(draft.branch_id);
  await writer.deleteBranch({branch_id:source.id,expected_version:source.version,request_id:randomUUID()});
  await page.goto(new URL('/knowledge',documentUrl).href);
  await voteViaWeb(page,'协作经验');
  const p=(await writer.tagProposals()).proposals.find(p=>p.name==='协作经验');
  assert.equal(p.approval_count,1);
  for(const w of others)await w.approveTag({id:p.id,request_id:randomUUID()});
  await page.goto(documentUrl);
  let drawer=await inspectTag(page,'协作经验');
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
  await page.locator('.kb-issue-source').waitFor();
  await page.reload();
  assert.match(await page.locator('.kb-issue-source').innerText(),/这个定义应补充协作中的约束/);
  await page.goto(documentUrl);
  drawer=await inspectTag(page,'协作经验');
  await drawer.getByRole('button',{name:'编辑标签'}).click();
  const edit=page.getByRole('dialog',{name:'编辑标签',exact:true});
  await fillTag(edit,'协作方法','明确约束并协调参与者需求。');
  await edit.getByRole('button',{name:'提交标签修改'}).click();
  await edit.waitFor({state:'detached'});
  assert.equal((await writer.category('main',p.category_id)).name,'协作经验');
  const rename=(await writer.tagProposals()).proposals.find(p=>p.name==='协作方法');
  for(const w of services)await w.approveTag({id:rename.id,request_id:randomUUID()});
  await page.goto(documentUrl);
  drawer=await inspectTag(page,'协作方法');
  await drawer.getByText('原文已变更的批注（1）',{exact:true}).waitFor();
  await drawer.getByRole('button',{name:'关闭标签侧栏'}).click();
  assert.equal((await writer.list({})).documents.length,before);
  const stored=(await writer.issues()).issues.find(i=>i.title==='澄清协作经验的边界');
  assert.equal(JSON.parse(stored.source_json).quote,'协调合作的经验。');
  await page.setViewportSize({width:320,height:800});
  await page.goto(new URL('/knowledge',documentUrl).href);
  form=await openForm(page);
  await fillTag(form,'手机标签','手机上创建和选择标签。');
  await form.getByRole('button',{name:'提议新标签'}).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.ok(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.screenshot({path:out+'/category-editor-mobile.png',fullPage:true});
  await form.getByRole('button',{name:'取消',exact:true}).click();
  await page.setViewportSize({width:1440,height:1080});
  await page.goto(documentUrl);
  return {independent:true,rename:true,definitionAnnotation:true,issueSource:true,oldReference:true,mobileEditor:true,ballot:true};
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
  await page.getByRole('dialog',{name:'预览独立标签标签定义与留言'}).getByRole('button',{name:'关闭标签侧栏'}).click();
  await voteViaWeb(page,'预览独立标签');
  await page.getByRole('button',{name:/已入库/}).first().click();
  await page.getByRole('button',{name:/审核应该了解什么/}).first().click();
  await page.getByRole('button',{name:'建议修改',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'修改文档',exact:true});
  await edit.getByLabel('修改说明').fill('预览草稿审核流程');
  await edit.getByRole('button',{name:'保存草稿',exact:true}).click();
  await page.getByRole('button',{name:'提交到审核',exact:true}).click();
  const review=page.getByRole('dialog',{name:'提交到审核',exact:true});
  await review.getByRole('button',{name:'公开并提交审核'}).click();
  await page.getByRole('button',{name:'同意此版本',exact:true}).click();
  await page.getByText('我已同意',{exact:false}).first().waitFor();
  await page.screenshot({path:out+'/standalone-prototype-review.png',fullPage:true});
  await page.getByRole('button',{name:'版本协作',exact:true}).click();
  await page.getByRole('button',{name:'删除分支',exact:true}).click();
  await page.getByRole('dialog',{name:'删除分支',exact:true}).getByRole('button',{name:'确认删除',exact:true}).click();
  await page.locator('.kb-branch-choices button.active').filter({hasText:'主分支'}).waitFor();
}
