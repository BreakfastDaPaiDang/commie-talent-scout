import assert from 'node:assert/strict';

const trigger=page=>page.getByRole('button',{name:'知识库教程',exact:true});
const tutorial=page=>page.getByRole('dialog',{name:'知识库按钮说明',exact:true});
const caption=(page,id)=>page.locator('.kb-help-caption[data-help-id="'+id+'"]');
const definitions={
 'scope-main':'已形成共识，当前采用的正式内容',
 'scope-public':'已经提交，供成员讨论和审核的候选内容',
 'scope-drafts':'尚未提交，仅自己可见的个人内容',
};
async function fitted(page){
 await page.waitForFunction(()=>[...document.querySelectorAll('.kb-help-caption')].some(e=>getComputedStyle(e).visibility==='visible'));
 const result=await page.evaluate(()=>{
  const labels=[...document.querySelectorAll('.kb-help-caption')].map(e=>({id:e.dataset.helpId,r:e.getBoundingClientRect().toJSON()}));
  const overlap=[];for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i].r,b=labels[j].r;if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)overlap.push([labels[i].id,labels[j].id]);}
  return {overflow:document.documentElement.scrollWidth>innerWidth+1,outside:labels.filter(({r})=>r.left<0||r.right>innerWidth+1||r.top<0||r.bottom>innerHeight+1).map(x=>x.id),overlap,count:labels.length};
 });
 assert.equal(result.overflow,false);assert.deepEqual(result.outside,[]);assert.deepEqual(result.overlap,[],JSON.stringify(result));assert.ok(result.count>1);
}
async function aligned(page,id,selector){
 await page.waitForFunction(({id,selector})=>{
  const dot=document.querySelector('[data-help-line="'+id+'"] circle'),target=document.querySelector(selector);if(!dot||!target)return false;
  const rect=target.getBoundingClientRect(),x=Number(dot.getAttribute('cx')),y=Number(dot.getAttribute('cy'));
  return x>=rect.left-1&&x<=rect.right+1&&y>=rect.top-1&&y<=rect.bottom+1;
 },{id,selector});
}
async function close(page){await page.keyboard.press('Escape');await tutorial(page).waitFor({state:'detached'});}

export async function verifyKnowledgeHelp(page,out,documentUrl){
 const writes=[],onRequest=request=>{if(request.url().includes('/api/knowledge-workspace')&&request.method()!=='GET')writes.push(request.url());};page.on('request',onRequest);
 try{
  await page.goto(documentUrl);await page.locator('.kb-article-title').waitFor();const before=page.url();
  assert.equal(await tutorial(page).count(),0);assert.equal(await trigger(page).count(),1);
  const original=await page.locator('.kb-categories').boundingBox();
  await trigger(page).click();await tutorial(page).waitFor();await fitted(page);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'关闭按钮说明');
  for(const [id,text] of Object.entries(definitions)){assert.ok((await caption(page,id).innerText()).includes(text));await aligned(page,id,'[data-kb-help="'+id+'"]');}
  assert.equal(await page.locator('dialog[open]').count(),0,'help is drawn on the page, not a native modal');
  assert.equal(await tutorial(page).getByRole('searchbox').count(),0);
  await aligned(page,'share','.kb-detail-toolbar .share-link');await aligned(page,'view','.kb-view-switch');
  await page.screenshot({path:out+'/tutorial-desktop.png',fullPage:true});
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'关闭按钮说明');
  await page.setViewportSize({width:1024,height:900});await aligned(page,'view','.kb-view-switch');await fitted(page);await page.screenshot({path:out+'/tutorial-resized.png',fullPage:true});
  await page.setViewportSize({width:1440,height:760});await aligned(page,'view','.kb-view-switch');
  // Wheel scrolling stays native; captions track visible real controls.
  await page.mouse.move(1100,700);await page.mouse.wheel(0,500);
  await page.waitForFunction(()=>document.querySelector('.kb-detail-scroll').scrollTop>0);
  await aligned(page,'edit','[data-kb-help="edit"]');await fitted(page);
  await page.screenshot({path:out+'/tutorial-scrolled.png',fullPage:true});
  const scroll=await page.locator('.kb-detail-scroll').evaluate(el=>el.scrollTop);
  await close(page);assert.equal(page.url(),before);assert.equal(await page.locator('.kb-detail-scroll').evaluate(el=>el.scrollTop),scroll);
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'知识库教程');
  assert.deepEqual(await page.locator('.kb-categories').boundingBox(),original,'closing restores the original layout');
  await page.setViewportSize({width:1440,height:1080});await page.goto(documentUrl);await page.locator('.kb-article-title').waitFor();await trigger(page).click();
  await page.getByRole('button',{name:'＋ 新条目',exact:true}).click();await tutorial(page).waitFor({state:'detached'});
  assert.equal(await page.getByRole('dialog',{name:'新条目',exact:true}).count(),0,'dismissal click must not trigger the underlying action');
  await page.getByRole('button',{name:'＋ 新条目',exact:true}).click();await page.getByRole('dialog',{name:'新条目',exact:true}).waitFor();await page.keyboard.press('Escape');
  await trigger(page).click();await page.mouse.click(900,1040);await tutorial(page).waitFor({state:'detached'});
  await page.getByRole('button',{name:'分类：知性',exact:true}).click({button:'right'});
  const category=page.getByRole('dialog',{name:'知性分类定义与留言',exact:true});await category.waitFor();
  await trigger(page).click();await caption(page,'category-edit').waitFor();await caption(page,'category-comment').waitFor();await fitted(page);
  await aligned(page,'category-close','.kb-category-drawer [aria-label="关闭分类侧栏"]');await page.screenshot({path:out+'/tutorial-category.png',fullPage:true});
  await close(page);assert.equal(await category.isVisible(),true,'help preserves the open category sidebar');await page.keyboard.press('Escape');await category.waitFor({state:'detached'});
  await page.getByRole('button',{name:'繁',exact:true}).click();
  for(const [tab,id] of [['分支','new-branch'],['议题','new-issue'],['历史','history-row']]){
   await page.locator('.kb-content-tabs').getByRole('button',{name:tab,exact:true}).click();
   if(tab==='历史')await page.locator('.kb-history-row').first().waitFor();
   await trigger(page).click();await caption(page,id).waitFor();await fitted(page);
   await page.screenshot({path:out+'/tutorial-'+id+'.png',fullPage:true});await close(page);
  }
  const draftUrl=new URL(documentUrl);draftUrl.search='?scope=drafts&mode=git';await page.goto(draftUrl.href);await page.locator('.kb-empty').waitFor();await trigger(page).click();await fitted(page);
  assert.equal(await caption(page,'edit').count(),0);assert.equal(await caption(page,'quote').count(),0);await close(page);
  await page.goto(documentUrl);await page.locator('.kb-article-title').waitFor();
  const theme=await page.evaluate(()=>document.documentElement.getAttribute('data-theme'));await page.evaluate(()=>document.documentElement.setAttribute('data-theme','night'));await trigger(page).click();await fitted(page);await page.screenshot({path:out+'/tutorial-night.png',fullPage:true});await close(page);await page.evaluate(value=>value===null?document.documentElement.removeAttribute('data-theme'):document.documentElement.setAttribute('data-theme',value),theme);
  for(const width of [390,320]){
   await page.setViewportSize({width,height:844});await page.goto(documentUrl);await page.locator('.kb-article-title').waitFor();
   assert.equal(await trigger(page).count(),1);await trigger(page).click();await fitted(page);
   assert.equal(await caption(page,'scope-main').count(),0,'hidden list controls have no captions on mobile detail');
   await aligned(page,'back','.kb-mobile-back');if(width===390)await page.screenshot({path:out+'/tutorial-mobile-detail.png',fullPage:true});await close(page);
   await page.getByRole('button',{name:'← 条目',exact:true}).click();assert.equal(await trigger(page).count(),1);
   if(width===390)await page.screenshot({path:out+'/tutorial-mobile-entry.png',fullPage:true});
   await trigger(page).click();await fitted(page);
   for(const [id,text] of Object.entries(definitions)){assert.ok((await caption(page,id).innerText()).includes(text));await aligned(page,id,'[data-kb-help="'+id+'"]');}
   assert.equal(await caption(page,'view').count(),0);assert.equal(await caption(page,'quote').count(),0);
   await page.screenshot({path:out+'/tutorial-mobile-'+width+'.png',fullPage:true});
   await tutorial(page).getByRole('button',{name:'关闭按钮说明',exact:true}).click();await tutorial(page).waitFor({state:'detached'});
   assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'知识库教程');
  }
  assert.deepEqual(writes,[]);
  await page.setViewportSize({width:1440,height:1080});await page.goto(documentUrl);await page.locator('.kb-article-title').waitFor();
  return {desktop:true,mobile:true,narrow:true,context:true,categoryPreserved:true,anchored:true,resize:true,scroll:true,definitions:true,focusRestore:true,night:true,noWrites:true,noClickThrough:true};
 }finally{page.off('request',onRequest);}
}

export async function verifyReadOnlyKnowledgeHelp(page){
 await trigger(page).click();await fitted(page);
 assert.ok((await caption(page,'scope-main').innerText()).includes(definitions['scope-main']));
 for(const id of ['scope-public','scope-drafts','new-entry','category-add','approve','edit'])assert.equal(await caption(page,id).count(),0);
 await tutorial(page).getByRole('button',{name:'关闭按钮说明',exact:true}).click();await tutorial(page).waitFor({state:'detached'});
}
