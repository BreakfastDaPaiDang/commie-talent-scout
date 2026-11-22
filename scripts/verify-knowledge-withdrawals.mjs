import assert from 'node:assert/strict';
import {request} from '../knowledge/tests/fixture.mjs';

export async function verifyWithdrawals(page, base, [writer,other]) {
  const byName = name => page.getByRole('button',{name,exact:true});
  const draft = await writer.createBranch({name:'撤回测试',visibility:'private',request_id:request()});
  const doc = await writer.save({branch_id:draft.id,expected_version:1,title:'候审文档',category:'知性',body:'原稿内容',message:'草稿',request_id:request()});
  const review = await writer.submitReview({branch_id:draft.id,expected_version:doc.version,document_id:doc.id,version_id:doc.version_id,request_id:request()});
  for (const w of [writer,other]) await w.approve({id:review.id,head_id:review.head_id,request_id:request()});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/knowledge?review='+review.id+'&head='+review.head_id);
  await byName('撤回到草稿').click();
  await byName('编辑草稿').click();
  const article = page.getByRole('dialog',{name:'修改文档',exact:true});
  await article.getByLabel('标题',{exact:true}).fill('修改后的文档');
  await article.getByRole('button',{name:'保存草稿',exact:true}).click();
  await page.getByRole('heading',{name:'修改后的文档',exact:true}).waitFor();
  assert.equal((await writer.mergeRequest(review.id)).state,'closed');

  const tag = await writer.editCategory({name:'标签撤回验收',definition:'原解释',request_id:request()});
  for (const w of [writer,other]) await w.approveTag({id:tag.proposal_id,request_id:request()});
  await page.goto(base+'/knowledge?tagProposal='+tag.proposal_id);
  await byName('撤回到草稿').click();
  const title = page.getByLabel('标签名称',{exact:true}), explanation=page.getByRole('textbox',{name:/^标签解释/});
  await title.waitFor();
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await byName('重新提交认可').scrollIntoViewIfNeeded();
  }
  await page.setViewportSize({width:1440,height:1000});
  await explanation.fill('可继续编辑的解释');
  const [saved] = await Promise.all([page.waitForResponse(r=>r.url().endsWith('/tag-drafts/save') && r.request().method()==='POST'),byName('保存草稿').click()]);
  assert.ok(saved.ok());
  await page.reload();await explanation.waitFor();
  assert.equal(await explanation.inputValue(),'可继续编辑的解释');
  await byName('重新提交认可').click();
  await page.locator('.kb-review-ballot').getByLabel('0 / 3 人认可').waitFor();
  assert.notEqual(new URL(page.url()).searchParams.get('tagProposal'),tag.proposal_id);
  return {documentWithTwoApprovals:true,persistentTagDraft:true,newBallot:true};
}
