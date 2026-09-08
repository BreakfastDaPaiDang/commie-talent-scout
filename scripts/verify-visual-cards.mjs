import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {fixture,uuid,archives,errors} from './ui-review-fixtures.mjs';
const out='tmp/verification/visual-cards';mkdirSync(out,{recursive:true});
const extra={...archives[0].tags[0],tag_id:uuid('same-category'),name:'版式设计',focus:0};
archives[0].tags.push(extra);archives[0].tag_summary.total=3;
Object.assign(archives[1],{status:'已入伙',closed:true});Object.assign(archives[2],{status:'已弃用',closed:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[];
const check=(name,ok)=>{checks.push({name,ok});assert.ok(ok,name);};
try{
 const context=await browser.newContext({viewport:{width:1440,height:1080}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',fixture);await page.route('**/avatars/**',r=>r.fulfill({status:404,body:''}));
 await page.goto((process.env.CTS_UI_BASE??'http://127.0.0.1:8790')+'/?archive='+uuid('p1'));await page.locator('.record-body').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 check('删除计数与排序整行，保留范围计数',await page.locator('.list-caption').count()===0&&(await page.locator('.scope-tabs small').allTextContents()).join(',')==='137,42,11');
 check('常态不显示字段名或星号',await page.locator('.assignment-label,.work-marker,.tag-category,.tag-focus,.archive-tags>header').count()===0);
 check('无成员不留占位',await page.locator('.entity-row').nth(1).locator('.row-binding').count()===0);
 const chips=await page.locator('.archive-tags .tag-chip').evaluateAll(es=>es.map(e=>({text:e.textContent,title:e.title,color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor,padding:getComputedStyle(e).padding})));
 check('同类别同色，不同类别区分，重点与普通外形一致',chips[0].background===chips[2].background&&chips[0].color===chips[2].color&&chips[0].background!==chips[1].background&&chips.every(c=>c.padding===chips[0].padding));
 check('仅显示标签名，类别可悬停查看',chips[0].text==='视频剪辑'&&chips[0].title==='技能：视频剪辑');
 await page.locator('.archive-tags .tag-binding-button').first().click();await page.getByRole('dialog',{name:'技能：视频剪辑',exact:true}).waitFor();await page.keyboard.press('Escape');await page.locator('.entity-heading h1').click();
 for(const width of [1920,1440,1024,390]){
  await page.setViewportSize({width,height:width<600?844:1080});
  if(width<600)await page.getByRole('button',{name:'关闭档案详情',exact:true}).click();
  check(`卡片 ${width} 完成标记直接盖住淡化内容`,await page.locator('.entity-row').evaluateAll(es=>es.every(e=>{const r=e.getBoundingClientRect(),stamp=e.querySelector('.completion-stamp')?.getBoundingClientRect(),content=e.querySelector('.row-content'),c=content.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1&&(!stamp||(stamp.width>=140&&stamp.left<c.right&&stamp.right>c.left&&stamp.top<c.bottom&&stamp.bottom>c.top&&Math.abs((stamp.left+stamp.right)/2-(r.left+r.right)/2)<2&&getComputedStyle(content).opacity==='0.3'));})));
  check(`卡片 ${width} 大勾大叉均清晰存在`,await page.locator('.completion-stamp.joined').count()===1&&await page.locator('.completion-stamp.discarded').count()>=1);
  await page.screenshot({path:out+`/cards-${width}.png`});
 }
 await page.setViewportSize({width:1440,height:1080});await page.locator('.entity-row').nth(1).click();await page.getByRole('button',{name:'重新开启',exact:true}).waitFor();
 check('完成卡片仍可打开，详情只读且可重新开启',await page.locator('.observation-composer').count()===0&&await page.getByRole('button',{name:'编辑档案',exact:true}).count()===0);
 await page.locator('.entity-row').first().click();await page.getByRole('textbox',{name:'新的观察记录',exact:true}).click();
 check('图片提示仅可粘贴',await page.locator('.composer-hint').textContent()==='可粘贴');
 await page.getByRole('button',{name:'筛选',exact:true}).click();await page.getByRole('combobox',{name:'筛选业务状态',exact:true}).selectOption('个人接触');await page.getByRole('button',{name:'清除条件',exact:true}).click();check('删去计数行后仍可清除筛选',await page.getByRole('combobox',{name:'筛选业务状态',exact:true}).inputValue()==='');
 await page.getByRole('button',{name:'编辑档案',exact:true}).click();await page.getByRole('button',{name:'保存资料',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});await page.locator('.entity-header [role="status"]').waitFor();await page.locator('.entity-header [role="status"]').waitFor({state:'detached',timeout:5000});checks.push({name:'普通保存提示自动消失',ok:true});
 check('无浏览器和接口错误',errors.length===0);
}finally{writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));await browser.close();}
