import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {fixture,uuid} from './ui-review-fixtures.mjs';
const out='tmp/verification/ui-simplicity';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const failures=[],checks=[];
function check(name,ok){checks.push({name,ok});if(!ok)failures.push(name);}
try{
 const context=await browser.newContext({viewport:{width:1440,height:1080},timezoneId:'America/Los_Angeles'}),page=await context.newPage();
 page.on('pageerror',e=>failures.push(e.message));
 await page.route('**/api/**',fixture);await page.route('**/avatars/**',r=>r.fulfill({status:404,body:''}));
 await page.goto((process.env.CTS_UI_BASE??'http://127.0.0.1:8790')+'/?archive='+uuid('p1'));await page.locator('.record-body').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 check('范围按钮显示服务端总数',await page.locator('.scope-tabs button small').count()===3);
 check('档案常态只有统一编辑入口，状态为展示',await page.locator('.entity-header button:not(.contact-pill)').count()===1 && await page.locator('button.state-badge').count()===0 && await page.locator('.archive-tags>header button').count()===0);
 await page.screenshot({path:out+'/detail.png'});
 await page.getByRole('textbox',{name:'新的观察记录',exact:true}).click();
 check('观察发布无需手动填写时间',await page.locator('input[type="datetime-local"]').count()===0);
 check('上传只显示设计后的图片按钮',await page.locator('input[type="file"]').evaluateAll(es=>es.every(e=>getComputedStyle(e).opacity==='0'||getComputedStyle(e).display==='none')));
 check('不在发布区展示保留周期和内部流程',!await page.locator('.observation-composer').innerText().then(t=>/30 天|上传完成后|发生时间/.test(t)));
 await page.screenshot({path:out+'/composer.png'});
 const fonts=await page.evaluate(()=>Object.fromEntries(['body','.record-body','.record-byline time','.row-foot time','.scope-tabs small','.composer textarea','.tag-chip'].map(s=>[s,getComputedStyle(document.querySelector(s)).fontFamily])));
 check('正文、辅助信息、控件使用统一字体',new Set(Object.values(fonts)).size===1);
 check('范围计数不是当前页条数',(await page.locator('.scope-tabs small').allTextContents()).join(',')==='137,42,11');
 check('标签只显示名称，按类别着色且不显示星号',await page.locator('.archive-tags .tag-chip').first().evaluate(e=>{const s=getComputedStyle(e);return s.borderWidth==='0px'&&s.backgroundColor!=='rgba(0, 0, 0, 0)'&&!e.querySelector('.tag-category')&&!e.querySelector('.tag-focus')&&!!e.querySelector('.tag-name');}));
 const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const {root}=await cdp.send('DOM.getDocument');const glyphFonts={};
 for(const selector of ['.record-body p','.entity-heading h1','.row-foot time','.assigned-members .member-chip','.tag-name']){const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});glyphFonts[selector]=(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;}
 check('实际中文与数字字形使用本地统一字体',Object.values(glyphFonts).flat().every(f=>f.isCustomFont&&f.postScriptName.startsWith('NotoSansSC')));await cdp.detach();
 const shownTime=await page.locator('.record-byline time').first().textContent();
 check('浏览器设为洛杉矶时仍显示东八区',shownTime.includes('14:32'));
 await page.getByRole('button',{name:'编辑档案',exact:true}).click();const dialog=page.getByRole('dialog',{name:'编辑档案',exact:true});
 await dialog.getByRole('textbox',{name:'昵称',exact:true}).fill('保留未提交的资料');await dialog.getByRole('tab',{name:'状态与成员',exact:true}).click();await dialog.getByRole('radio',{name:'个人接触',exact:true}).check();
 await page.screenshot({path:out+'/state.png'});
 await dialog.getByRole('tab',{name:'资料',exact:true}).click();check('编辑页签切换保留未提交的资料',await dialog.getByRole('textbox',{name:'昵称',exact:true}).inputValue()==='保留未提交的资料');
 await dialog.getByRole('button',{name:'＋ 添加联系方式',exact:true}).click();await dialog.getByRole('textbox',{name:'联系方式2',exact:true}).fill('123456789');
 await page.screenshot({path:out+'/profile.png'});
 for(const width of [1920,1440,1024,390]){await page.setViewportSize({width,height:width<600?844:1080});await page.screenshot({path:out+`/profile-${width}.png`});check(`资料表单 ${width} 无横向溢出`,await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));check(`资料表单 ${width} 保存按钮始终可见`,await dialog.getByRole('button',{name:'保存资料',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));}
 await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1080});
 for(const width of [1920,1440,1024,390]){await page.setViewportSize({width,height:width<600?844:1080});await page.screenshot({path:out+`/composer-${width}.png`});check(`展开发布区 ${width} 无横向溢出`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:1440,height:1080});
 await page.getByRole('button',{name:'编辑档案',exact:true}).click();let editor=page.getByRole('dialog',{name:'编辑档案',exact:true});await editor.getByRole('tab',{name:'标签',exact:true}).click();await editor.getByRole('button',{name:'＋ 添加',exact:true}).click();
 let release,arrived,finished;const arrival=new Promise(r=>arrived=r),completion=new Promise(r=>finished=r);let firstRefresh=true;
 const gate=async route=>{if(!firstRefresh)return fixture(route);firstRefresh=false;await new Promise(r=>{release=r;arrived();});await fixture(route);finished();};await page.route('**/api/archives/'+uuid('p1'),gate);
 await page.getByRole('dialog',{name:'添加标签',exact:true}).locator('.tag-choice-list article').filter({hasText:'整理材料'}).getByRole('button',{name:'添加',exact:true}).click();await arrival;
 await page.getByRole('dialog',{name:'添加标签',exact:true}).waitFor({state:'detached'});await editor.getByRole('button',{name:'关闭对话框',exact:true}).click();release();await completion;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 check('迟到的标签刷新不能重新打开已关闭编辑窗',await editor.count()===0);if(await editor.count())await editor.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.unroute('**/api/archives/'+uuid('p1'),gate);
 await page.getByRole('button',{name:'Agent 接入',exact:true}).click();
 check('Agent 接入直述用途，移除内部保留策略',await page.locator('.agent-copy').innerText().then(t=>/帮你/.test(t)&&!/排错|保留 30|180 天/.test(t)));
 await page.screenshot({path:out+'/agent.png'});
 writeFileSync(out+'/report.json',JSON.stringify({checks,fonts,glyphFonts,shownTime,failures},null,2));console.log(JSON.stringify({checks,fonts,failures},null,2));assert.deepEqual(failures,[]);
}finally{await browser.close();}
