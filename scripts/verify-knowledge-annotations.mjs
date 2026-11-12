import assert from 'node:assert/strict';

// Select actual rendered source, including ranges split by overlapping annotations.
export async function selectKnowledgeText(page,quote){
 await page.locator('.kb-body [data-kb-start]').filter({hasText:quote}).first().scrollIntoViewIfNeeded();
 await page.evaluate(quote=>{
  const span=[...document.querySelectorAll('.kb-body [data-kb-start]')].find(n=>n.textContent.includes(quote)),start=span.textContent.indexOf(quote),end=start+quote.length,walker=document.createTreeWalker(span,NodeFilter.SHOW_TEXT),range=document.createRange();
  let node,offset=0,started=false;
  while(node=walker.nextNode()){
   const next=offset+node.textContent.length;
   if(!started&&start<next){range.setStart(node,start-offset);started=true;}
   if(started&&end<=next){range.setEnd(node,end-offset);break;}
   offset=next;
  }
  const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
 },quote);
 await page.getByRole('toolbar',{name:'选中文字操作'}).waitFor();
 assert.equal(await page.evaluate(()=>getSelection().toString()),quote,'native selection survives React rendering');
}

async function activeSource(page,text){
 await page.waitForFunction(expected=>[...document.querySelectorAll('.kb-quote.is-active')].map(n=>n.textContent).join('')===expected,text);
 const weights=await page.locator('.kb-quote.is-active').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).fontWeight));
 assert.ok(weights.every(w=>Number(w)>=700));
}
async function annotate(page,quote,body){
 await selectKnowledgeText(page,quote);
 await page.getByRole('toolbar').getByRole('button',{name:'批注',exact:true}).click();
 await page.getByLabel('针对这句话写下批注…').fill(body);
 await page.getByRole('button',{name:'发布批注',exact:true}).click();
 await page.locator('.kb-annotation').filter({hasText:body}).waitFor();
}

export async function verifyKnowledgeAnnotations(page,out){
 const quote='结合过往经历或作品判断实际水平。',inner='过往经历或作品',other='了解可以投入的时间与精力。',comment='可引用实际作品，不能只看自述。';
 const item=()=>page.locator('.kb-annotation').filter({hasText:comment});
 await page.locator('.kb-article-title').click();await activeSource(page,'');
 await item().click();await activeSource(page,quote);
 const style=await item().evaluate(el=>({background:getComputedStyle(el).backgroundColor,opacity:getComputedStyle(el).opacity,avatar:el.querySelector('.avatar')!==null,font:getComputedStyle(el.querySelector('.kb-annotation-text')).fontFamily,children:el.children.length,controls:el.querySelectorAll('button,time,.kb-comment-meta').length}));
 assert.equal(style.background,'rgba(48, 48, 48, 0.4)');assert.equal(style.opacity,'1');assert.equal(style.avatar,true);assert.match(style.font,/KaiTi/i);assert.equal(style.children,2);assert.equal(style.controls,0);
 await page.screenshot({path:out+'/annotation-desktop.png',fullPage:true});
 await page.keyboard.press('Escape');await activeSource(page,'');
 await page.locator('.kb-quote').first().click();await activeSource(page,quote);
 await page.locator('.kb-article-title').click();await activeSource(page,'');
 await item().focus();await page.keyboard.press('Enter');await activeSource(page,quote);
 await page.getByRole('button',{name:'繁',exact:true}).focus();await activeSource(page,'');
 await selectKnowledgeText(page,quote);await activeSource(page,quote);
 await page.locator('.kb-detail-scroll').evaluate(el=>el.scrollTop+=5);await activeSource(page,quote);
 await page.keyboard.press('Escape');await activeSource(page,'');

 // Reply remains available without permanent action bars, and inherits its parent's quote.
 await item().click({button:'right'});await page.getByRole('menuitem',{name:'回复批注'}).click();
 const reply=page.locator('.kb-annotation-form textarea');await reply.fill('同意，需说明作品中的实际分工。');
 await reply.press('Control+Enter');await page.locator('.kb-annotation').filter({hasText:'同意，需说明作品中的实际分工。'}).waitFor();
 await annotate(page,inner,'也应核对当时承担的职责。');
 await annotate(page,other,'投入时间需要结合当前安排核实，保持沟通并及时更新；较长的批注也应在手机上自然换行，不挤压正文。');
 await page.locator('.kb-annotation').filter({hasText:'也应核对当时承担的职责。'}).click();await activeSource(page,inner);
 await selectKnowledgeText(page,quote);await activeSource(page,quote);
 await page.locator('.kb-article-title').click();await activeSource(page,'');
 await page.reload();await item().waitFor();await activeSource(page,'');
 await item().click();await activeSource(page,quote);
 await page.getByRole('button',{name:'繁',exact:true}).click();await item().click();await activeSource(page,quote);
 await page.getByRole('button',{name:'简',exact:true}).click();

 // The same compact editor and selected-source behavior at phone width and at night.
 await page.setViewportSize({width:390,height:844});
 const long=page.locator('.kb-annotation').filter({hasText:'投入时间需要结合当前安排核实'});
 await long.scrollIntoViewIfNeeded();await long.dispatchEvent('pointerdown',{pointerType:'touch'});await long.click();await activeSource(page,other);
 assert.ok(await long.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:out+'/annotation-mobile.png',fullPage:true});
 await selectKnowledgeText(page,other);await page.getByRole('toolbar').getByRole('button',{name:'批注',exact:true}).click();
 await page.getByLabel('针对这句话写下批注…').fill('手机输入框的自动换行和发布按钮应在视口内。');
 const publish=page.getByRole('button',{name:'发布批注',exact:true});await publish.scrollIntoViewIfNeeded();
 const box=await publish.boundingBox();assert.ok(box.width>=44&&box.height>=44&&box.x+box.width<=390);
 await page.screenshot({path:out+'/annotation-editor-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'取消批注',exact:true}).click();
 await page.getByRole('button',{name:'切换到深夜模式'}).click();await long.scrollIntoViewIfNeeded();await long.click();await activeSource(page,other);
 const night=await long.evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));assert.equal(night.background,style.background);assert.notEqual(night.color,'rgb(32, 32, 32)');
 await page.screenshot({path:out+'/annotation-night-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'切换到日间模式'}).click();await page.setViewportSize({width:1440,height:1080});await page.locator('.kb-article-title').click();await activeSource(page,'');
 return {minimal:true,backgroundOpacity:.4,sourceSelection:true,keyboard:true,overlap:true,reply:true,mobile:true,night:true};
}

export async function verifyGuestAnnotation(page){
 const quote='了解可以投入的时间与精力。',annotation=page.locator('.kb-annotation').filter({hasText:'投入时间需要结合当前安排核实'});
 await annotation.click();await activeSource(page,quote);
 assert.equal(await page.locator('.kb-annotation img').count(),0,'guest does not request member HR avatars');
 assert.equal(await page.locator('.kb-annotation-form').count(),0);
 await page.locator('.kb-article-title').click();await activeSource(page,'');
 await page.locator('.kb-quote').filter({hasText:quote}).click();await activeSource(page,quote);
}
