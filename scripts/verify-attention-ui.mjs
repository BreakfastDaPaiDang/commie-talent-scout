import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {initialEntities} from '../prototypes/frontend/src/model.js';
import {fixture,uuid,archives,errors} from './ui-review-fixtures.mjs';
const base=process.env.CTS_UI_BASE??'http://127.0.0.1:8790',out='tmp/verification/attention-ui';mkdirSync(out,{recursive:true});
archives[0].unread_count=3;Object.assign(archives[0].tags[0],{category_name:'可用性',name:'固定时段',description:'已明确可投入的重复时段；时间、时区及适用期间见依据。',color:'slate'});archives[0].tags[0].evidence=[{kind:'observation',note:'2026 年九月，每周三晚北京时间，范围以本次自述为限。',observation_id:uuid(initialEntities[0].records[0].id),content_version:1}];
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[];
function check(name,ok){checks.push({name,ok});}
try{
 const context=await browser.newContext({viewport:{width:1440,height:1080}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',fixture);await page.route('**/avatars/**',r=>r.fulfill({status:404,body:''}));
 await page.goto(base+'/?archive='+uuid('p1'));await page.locator('.record-body').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 check('卡片与详情都保留类别：名称',(await page.locator('.tag-chip').allTextContents()).every(t=>t.includes('：')));
 check('有更新的卡片显示醒目提示',await page.locator('.entity-row').first().locator('.row-unread').count()===1);
 check('卡片时间至少 14px',await page.locator('.row-foot time').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=14));
 await page.locator('.archive-tags .tag-binding-button').first().click();const dialog=page.getByRole('dialog',{name:'可用性：固定时段',exact:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:width<600?844:1080});check(`标签弹窗 ${width} 标题栏布局完整`,await dialog.evaluate(e=>{const h=e.querySelector('.modal-head'),s=getComputedStyle(h),r=h.getBoundingClientRect(),title=h.querySelector('h2').getBoundingClientRect(),close=h.querySelector('button').getBoundingClientRect();return s.display==='flex'&&parseFloat(s.paddingLeft)>=20&&title.left>=r.left+20&&close.left>=title.right&&Math.abs((close.top+close.bottom)/2-(r.top+r.bottom)/2)<10;}));check(`标签弹窗 ${width} 无横向溢出`,await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:out+`/tag-${width}.png`});}
 await page.setViewportSize({width:1440,height:1080});await dialog.getByRole('button',{name:/查看来源/}).click();await page.getByRole('dialog',{name:'引用的观察版本',exact:true}).waitFor();check('标签来源仍可打开所引用版本',await page.getByRole('dialog',{name:'引用的观察版本',exact:true}).innerText().then(t=>t.includes(initialEntities[0].records[0].body.slice(0,20))));await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1080});await page.locator('.entity-heading h1').click();await page.screenshot({path:out+'/cards-1440.png'});await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'关闭档案详情',exact:true}).click();check('手机更新提示与放大的时间清晰可见',await page.locator('.entity-row').first().evaluate(e=>{const flag=e.querySelector('.row-unread'),title=e.querySelector('.row-title h2').getBoundingClientRect(),f=flag.getBoundingClientRect();return f.left>=title.right&&f.right<=innerWidth&&parseFloat(getComputedStyle(e.querySelector('.row-foot time')).fontSize)>=14;}));await page.screenshot({path:out+'/cards-390.png'});await page.setViewportSize({width:1440,height:1080});
 await page.route('**/api/reading/events?*',r=>r.fulfill({json:{events:[],snapshot:100,next_cursor:null}}));await page.getByRole('button',{name:/^未读更新/}).click();const art=page.locator('.caught-up img');await art.waitFor();await page.waitForFunction(()=>document.querySelector('.caught-up img')?.complete);check('未读空态望远镜插图实际加载',await art.evaluate(e=>e.naturalWidth>0));await page.screenshot({path:out+'/caught-up.png'});
 check('无浏览器与接口错误',errors.length===0);
}finally{await browser.close();writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));}
assert.ok(checks.every(c=>c.ok),'attention UI checks');
