import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
import {verificationClient} from './verification-client.mjs';

// Uses real staging auth/MCP. Never contacts a member's QCE or reads chat files.
const v=await verificationClient('auxiliary-tools'),checks=[],errors=[];
let browser,page,prototype;
const release='https://github.com/shuakami/qq-chat-exporter/releases/latest';
try{
  const who=await v.call('whoami');assert.ok(who.guide_topics.includes('qq_export'));
  const tools=await v.client.listTools(),tool=tools.tools.find(t=>t.name==='get_usage_guide');
  assert.ok(tool.inputSchema.properties.topic.enum.includes('qq_export'));
  assert.match(tool.description,/qq_export/);
  assert.match((await v.call('get_usage_guide',{topic:'overview'})).rules.join('\n'),/qq_export/);
  const guide=await v.call('get_usage_guide',{topic:'qq_export'}),rules=guide.rules.join('\n');
  for(const required of ['napiLoader.bat',release,'/health','data.online','standalone','accessToken','/api/messages/export','/api/tasks/{taskId}','compression'])assert.ok(rules.includes(required),`guide must cover ${required}`);
  assert.match(rules,/云端 MCP 不检测|云端或隔离容器/);assert.match(rules,/取得用户授权/);assert.match(rules,/响应丢失/);
  assert.ok((await v.call('get_usage_guide',{topic:'compression'})).rules.length>0);
  checks.push('real MCP discovery, schema and overview expose qq_export; guide covers local capability, launch consent, authenticated export, task recovery and existing compression');

  browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
  const [name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const localRequests=[];page.on('request',r=>{if(new URL(r.url()).port==='40653')localRequests.push(r.url());});
  await page.goto(v.base);
  const topLink=page.locator('.topbar-tools').getByRole('button',{name:'辅助工具',exact:true});
  await topLink.click();await page.getByRole('heading',{name:'辅助工具',exact:true}).waitFor();
  assert.equal(await topLink.getAttribute('aria-current'),'page');
  await page.goto(v.base);await page.locator('.account-menu>summary').click();
  await page.locator('.account-menu').getByRole('button',{name:'辅助工具',exact:true}).click();
  await page.waitForURL(v.base+'/tools');await page.getByRole('heading',{name:'辅助工具',exact:true}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'QQ Chat Exporter',exact:true}).waitFor();
  const download=page.getByRole('link',{name:'前往 GitHub 下载'});assert.equal(await download.getAttribute('href'),release);assert.equal(await download.getAttribute('target'),'_blank');
  assert.equal(await page.getByRole('link',{name:'本机导出页面'}).getAttribute('href'),'http://localhost:40653/qce');
  assert.equal(await page.locator('[aria-labelledby="qce-title"] .auxiliary-tutorial li').count(),5);
  const officialLinks={
    '查找网页历史':'https://web.archive.org/',
    '打开阅后即焚':'https://www.sixin.cc/',
  };
  for(const [name,url] of Object.entries(officialLinks)){
    const link=page.getByRole('link',{name,exact:true});assert.equal(await link.getAttribute('href'),url);assert.equal(await link.getAttribute('target'),'_blank');assert.match(await link.getAttribute('rel'),/noopener/);
  }
  assert.equal(await page.locator('[aria-labelledby="wayback-title"] li').count(),4);
  assert.equal(await page.locator('[aria-labelledby="sixin-title"] li').count(),3);
  const sharedText=await page.locator('.auxiliary-tools').innerText();
  assert.match(sharedText,/NapCat-Framework-QCE-v版本号\.zip/);assert.match(sharedText,/D:\\QQ导出工具/);assert.match(sharedText,/napiLoader\.bat/);assert.match(sharedText,/TXT/);
  assert.match(sharedText,/不要自己先打开链接/);
  assert.equal(await page.locator('.auxiliary-heading p,.auxiliary-docs,.auxiliary-tip').count(),0);
  assert.equal(await page.locator('.auxiliary-intro a').count(),3);
  await page.evaluate(()=>document.fonts.ready);mkdirSync('tmp/verification',{recursive:true});
  await page.screenshot({path:`tmp/verification/auxiliary-tools-desktop-${v.target}.png`});
  checks.push('desktop top navigation and account menu open /tools with selected state; direct reload, QCE Framework guide, Wayback main link and Sixin destruction instructions work');
  for(const id of ['wayback','sixin']){await page.locator(`[aria-labelledby="${id}-title"]`).scrollIntoViewIfNeeded();await page.screenshot({path:`tmp/verification/auxiliary-tools-${id}-desktop-${v.target}.png`});}

  for(const width of [1024,390,360]){
    await page.setViewportSize({width,height:900});await page.goto(v.base);
    if(width<=600){await page.getByRole('button',{name:'打开工具导航',exact:true}).click();await page.locator('.mobile-menu').getByRole('button',{name:'辅助工具',exact:true}).click();}
    else {
      const nav=page.locator('.topbar-tools').getByRole('button',{name:'辅助工具',exact:true});await nav.click();
      const boxes=await page.locator('.primary-nav,.topbar-tools').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right};}));
      assert.ok(boxes[0].right<=boxes[1].x&&boxes[1].right<=width,'desktop tools must not overlap main navigation or viewport');
    }
    await page.getByRole('heading',{name:'辅助工具',exact:true}).waitFor();
    assert.ok(await page.locator('.auxiliary-tools').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    for(const link of await page.locator('.auxiliary-tools a').all()){await link.scrollIntoViewIfNeeded();assert.ok(await link.isVisible());}
    for(const step of await page.locator('.auxiliary-tutorial li').all()){await step.scrollIntoViewIfNeeded();assert.ok(await step.isVisible());const box=await step.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);}
    if(width===390){await page.locator('.auxiliary-tools').evaluate(e=>e.scrollTop=0);await page.screenshot({path:`tmp/verification/auxiliary-tools-mobile-top-${v.target}.png`});await page.locator('.auxiliary-tutorial li').last().scrollIntoViewIfNeeded();await page.screenshot({path:`tmp/verification/auxiliary-tools-mobile-steps-${v.target}.png`});}
    if(width===390)for(const id of ['wayback','sixin']){await page.locator(`#${id}-title`).scrollIntoViewIfNeeded();await page.screenshot({path:`tmp/verification/auxiliary-tools-${id}-mobile-${v.target}.png`});await page.locator(`[aria-labelledby="${id}-title"] li:last-child`).scrollIntoViewIfNeeded();await page.screenshot({path:`tmp/verification/auxiliary-tools-${id}-mobile-steps-${v.target}.png`});}
  }
  checks.push('1024/390/360px navigation, complete tutorial and links remain reachable without horizontal overflow');
  assert.deepEqual(localRequests,[]);assert.deepEqual(errors,[]);
  checks.push('recommendation page makes no QCE requests and has no browser runtime errors');

  if(v.target==='local'){
    prototype=await createServer({configFile:false,root:resolve('prototypes/frontend'),publicDir:resolve('public'),resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:5194,strictPort:true,fs:{allow:[resolve('.')]}}});await prototype.listen();
    await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:5194');
    if(await page.getByRole('button',{name:'进入工作台',exact:true}).isVisible())await page.getByRole('button',{name:'进入工作台',exact:true}).click();
    await page.locator('.topbar-tools').getByRole('button',{name:'辅助工具',exact:true}).click();
    assert.equal(await page.locator('.auxiliary-tools').innerText(),sharedText);
    await page.screenshot({path:'tmp/verification/auxiliary-tools-prototype.png'});
    assert.deepEqual(errors,[]);checks.push('prototype reaches the same shared auxiliary page and renders identical tutorial content');
  }
}catch(error){if(page){mkdirSync('tmp/verification',{recursive:true});await page.screenshot({path:`tmp/verification/auxiliary-tools-failure-${v.target}.png`});}throw error;}
finally{if(browser)await browser.close();if(prototype)await prototype.close();await v.close(checks);}
