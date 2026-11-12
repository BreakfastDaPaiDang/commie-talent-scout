import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {preview} from 'vite';
const server=await preview({preview:{host:'127.0.0.1',port:8794,strictPort:true}});
const browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true}),out='tmp/verification/whale-home';mkdirSync(out,{recursive:true});
const report=[],errors=[];
try{
 for(const width of [1440,1024,768,600,390,320])for(const theme of ['light','night']){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
  await context.addInitScript(mode=>localStorage.setItem('cts-display-mode',mode),theme);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/auth/me',r=>r.fulfill({status:401,json:{error:{code:'UNAUTHORIZED',message:'请登录'}}}));
  await page.goto('http://127.0.0.1:8794/');
  await page.getByRole('navigation',{name:'主页入口'}).waitFor();
  const links=page.locator('.whale-entrance');assert.equal(await links.count(),6);
  const expected={'外部人物':'/people','社员':'/members','任务':'/tasks','仪表盘':'/statistics','知识库':'/knowledge','Agent 接入':'/agent'};
  for(const [name,href]of Object.entries(expected))assert.equal(await page.getByRole('link',{name,exact:true}).getAttribute('href'),href);
  assert.equal(await page.locator('.whale-entrance--blue').getAttribute('href'),'/agent');
  await page.locator('.whale-entrance img').evaluateAll(els=>Promise.all(els.map(el=>el.decode())));
  assert.equal(await page.locator('.whale-entrance img').evaluateAll(els=>new Set(els.map(el=>el.src)).size),6);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const rects=await links.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {name:el.ariaLabel,x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}));
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];assert.ok(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,JSON.stringify({width,a,b}));}
  assert.ok(rects.every(r=>r.x>=0&&r.right<=width&&r.width>=44&&r.height>=44));
  await page.getByRole('link',{name:'Agent 接入',exact:true}).focus();
  assert.equal(await page.locator('.whale-entrance--blue').evaluate(el=>el===document.activeElement),true);
  const header=await page.locator('.topbar').boundingBox();
  for(const selector of ['.topbar .brand','.whale-home-account','.topbar>.theme-picker']){const r=await page.locator(selector).boundingBox();assert.ok(r.x>=0&&r.x+r.width<=width&&r.y>=header.y&&r.y+r.height<=header.y+header.height,JSON.stringify({width,selector,r,header}));}
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);document.querySelector('.app').scrollTop=0;});
  await page.screenshot({path:`${out}/${theme}-${width}.png`,fullPage:true,animations:'disabled'});
  await page.getByRole('link',{name:'Agent 接入',exact:true}).press('Enter');
  await page.getByRole('form',{name:'登录',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/agent');
  report.push({width,theme,sixLayers:true,noOverlaps:true,keyboardNavigation:true,loginTargetRetained:true});
  await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(out+'/result.json',JSON.stringify(report,null,2));console.log('PASS: 12 viewport/theme combinations, 6 independent layers and links, keyboard navigation and login target retention');
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
