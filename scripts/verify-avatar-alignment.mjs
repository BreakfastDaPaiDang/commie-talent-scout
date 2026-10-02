import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
import {fixture,archives,errors} from './ui-review-fixtures.mjs';

// Avatar surroundings were removed by the 2026-10-02 design revision.
// Keep the avatar visible and stable, without decorations or art requests.
const out='tmp/verification/avatar-alignment';mkdirSync(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:8793,strictPort:true}}),browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true}),checks=[],artRequests=[];
try{
 const context=await browser.newContext({viewport:{width:1920,height:1000}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/art/avatar-ornaments/'))artRequests.push(r.url());});
 await page.route('**/api/**',fixture);await page.route('**/avatars/**',r=>r.fulfill({path:'tests/fixtures/images/shapes.png',contentType:'image/png'}));
 for(const [scenario,name,width] of [['short','Maki',1920],['compact','端wood赐',1660],['long','美国民主社会主义者（DSA）',1920],['narrow','Maki',1024],['mobile','Maki',390]]){
  await page.setViewportSize({width,height:1000});archives[0].name=name;await page.goto('http://127.0.0.1:8793/?archive='+archives[0].id,{waitUntil:'domcontentloaded'});await page.locator('.entity-avatar img').waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.avatar-ornament,.avatar-composition,[data-ornament-fits]').count(),0);
  const geometry=await page.locator('.entity-avatar').evaluate(e=>{
   const avatar=e.querySelector('.avatar'),image=avatar.querySelector('img'),shell=e.getBoundingClientRect(),r=avatar.getBoundingClientRect(),s=getComputedStyle(e),a=getComputedStyle(avatar);
   return {onlyAvatar:e.childElementCount===1&&e.firstElementChild===avatar,imageLoaded:image.complete&&image.naturalWidth>0,plain:s.backgroundImage==='none'&&s.transform==='none'&&a.transform==='none',fits:Math.abs(shell.width-r.width)<1&&Math.abs(shell.height-r.height)<1,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  checks.push({scenario,...geometry,ok:geometry.onlyAvatar&&geometry.imageLoaded&&geometry.plain&&geometry.fits&&!geometry.overflow});
  await page.screenshot({path:`${out}/${scenario}.png`});
 }
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'展开阅读视图',exact:true}).click();
 assert.equal(await page.locator('.entity-avatar > .avatar img').isVisible(),true);assert.equal(await page.locator('.avatar-ornament').count(),0);
 await page.screenshot({path:`${out}/expanded.png`});await context.close();
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));writeFileSync(out+'/report.json',JSON.stringify({checks,errors,artRequests},null,2));}
console.log(JSON.stringify({checks,errors,artRequests},null,2));assert.ok(checks.every(c=>c.ok)&&!errors.length&&!artRequests.length,'detail header retains only its avatar, without decoration requests');
