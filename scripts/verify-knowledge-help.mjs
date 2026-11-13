import assert from 'node:assert/strict';

const trigger=page=>page.getByRole('button',{name:'知识库教程',exact:true});
const tutorial=page=>page.getByRole('dialog',{name:'知识库使用教程',exact:true});
async function fitted(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const box=await tutorial(page).boundingBox();assert.ok(box.x>=0&&box.x+box.width<=page.viewportSize().width+1);}

export async function verifyKnowledgeHelp(page,out,documentUrl){
 const writes=[],onRequest=request=>{if(request.url().includes('/api/knowledge-workspace')&&request.method()!=='GET')writes.push(request.url());};page.on('request',onRequest);
 try{
  await page.goto(documentUrl);await page.locator('.kb-article-title').waitFor();const before=page.url();
  assert.equal(await tutorial(page).count(),0);assert.equal(await trigger(page).count(),1);
  const right=await page.locator('.kb-detail-toolbar').evaluate(el=>{const r=el.getBoundingClientRect(),b=el.querySelector('.kb-help-button').getBoundingClientRect();return {gap:r.right-b.right,width:b.width,height:b.height};});assert.ok(Math.abs(right.gap)<2&&right.width>=44&&right.height>=44);
  await trigger(page).click();await tutorial(page).waitFor();await fitted(page);
  assert.equal(await tutorial(page).getByRole('button',{name:'阅读与查找',exact:false}).getAttribute('aria-expanded'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement?.className),'kb-help-intro');
  await page.screenshot({path:out+'/tutorial-desktop.png',fullPage:true});
  await tutorial(page).getByLabel('查找按钮',{exact:true}).fill('删除分支');
  await tutorial(page).getByText('删除分支 / 确认删除',{exact:true}).waitFor();
  assert.match(await tutorial(page).innerText(),/只有当前正式成员中的分支创建者/);
  await tutorial(page).getByLabel('查找按钮',{exact:true}).fill('不存在的按钮xyz');await tutorial(page).getByRole('status').waitFor();
  await page.keyboard.press('Escape');await tutorial(page).waitFor({state:'detached'});assert.equal(page.url(),before);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'知识库教程');
  await page.getByRole('button',{name:'繁',exact:true}).click();
  for(const [tab,chapter] of [['分支','分支与合并'],['议题','议题与结论'],['历史','历史与通用操作']]){
   await page.locator('.kb-content-tabs').getByRole('button',{name:tab,exact:true}).click();await trigger(page).click();
   assert.equal(await tutorial(page).getByRole('button',{name:chapter,exact:false}).getAttribute('aria-expanded'),'true');
   await tutorial(page).getByRole('button',{name:'关闭对话框',exact:true}).click();
  }
  const draftUrl=new URL(documentUrl);draftUrl.search='?scope=drafts&mode=git';await page.goto(draftUrl.href);await page.locator('.kb-empty').waitFor();await trigger(page).click();
  assert.equal(await tutorial(page).getByRole('button',{name:'草稿与审核',exact:false}).getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');
  await page.goto(documentUrl);await page.locator('.kb-article-title').waitFor();
  const theme=await page.evaluate(()=>document.documentElement.getAttribute('data-theme'));await page.evaluate(()=>document.documentElement.setAttribute('data-theme','night'));await trigger(page).click();await page.screenshot({path:out+'/tutorial-night.png',fullPage:true});await page.keyboard.press('Escape');await page.evaluate(value=>value===null?document.documentElement.removeAttribute('data-theme'):document.documentElement.setAttribute('data-theme',value),theme);
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});await page.goto(documentUrl);await page.locator('.kb-article-title').waitFor();
   assert.equal(await trigger(page).count(),1);await trigger(page).click();await fitted(page);await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'← 条目',exact:true}).click();assert.equal(await trigger(page).count(),1);
   const geometry=await page.locator('.kb-list-head').evaluate(el=>{const r=el.getBoundingClientRect(),b=el.querySelector('.kb-list-help').getBoundingClientRect(),search=el.querySelector('.kb-search').getBoundingClientRect();return {gap:r.right-b.right,searchWidth:search.width,below:search.top>=b.bottom};});assert.ok(Math.abs(geometry.gap)<2&&geometry.searchWidth>=170&&geometry.below);
   if(width===390)await page.screenshot({path:out+'/tutorial-mobile-entry.png',fullPage:true});
   await trigger(page).click();await fitted(page);await tutorial(page).getByLabel('查找按钮',{exact:true}).fill('批注');await tutorial(page).getByText('圈选文字 → 批注',{exact:true}).waitFor();
   if(width===390)await page.screenshot({path:out+'/tutorial-mobile.png',fullPage:true});
   await tutorial(page).getByRole('button',{name:'关闭对话框',exact:true}).click();
   assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'知识库教程');
  }
  assert.deepEqual(writes,[]);
  await page.setViewportSize({width:1440,height:1080});await page.goto(documentUrl);await page.locator('.kb-article-title').waitFor();
  return {desktop:true,mobile:true,narrow:true,context:true,search:true,focusRestore:true,night:true,noWrites:true};
 }finally{page.off('request',onRequest);}
}

export async function verifyReadOnlyKnowledgeHelp(page){
 await trigger(page).click();await fitted(page);assert.match(await tutorial(page).innerText(),/仅向正式成员开放/);
 assert.equal(await tutorial(page).getByRole('button',{name:'草稿与审核',exact:false}).count(),0);
 assert.equal(await tutorial(page).getByRole('button',{name:'分支与合并',exact:false}).count(),0);
 await tutorial(page).getByLabel('查找按钮',{exact:true}).fill('点赞同意');await tutorial(page).getByRole('status').waitFor();
 await tutorial(page).getByRole('button',{name:'关闭对话框',exact:true}).click();
}
