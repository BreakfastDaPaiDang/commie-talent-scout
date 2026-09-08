import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {fixture,archives,errors} from './ui-review-fixtures.mjs';
const base=process.env.CTS_UI_BASE??'http://127.0.0.1:8790',out='tmp/verification/archive-loading';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),samples=[];
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:width<600?844:1080}}),page=await context.newPage(),org=archives.find(a=>a.type==='org');
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',fixture);await page.route('**/avatars/**',r=>r.fulfill({status:404,body:''}));
  let release,arrived;const requested=new Promise(resolve=>arrived=resolve);
  await page.route('**/api/archives/'+org.id,async route=>{await new Promise(resolve=>{release=resolve;arrived();});await fixture(route);});
  await page.goto(base+'/organizations');await page.getByRole('button',{name:'查看'+org.name,exact:true}).waitFor();await page.getByRole('button',{name:'查看'+org.name,exact:true}).click();await requested;
  const pending=await page.evaluate(()=>({path:location.pathname,active:document.querySelector('.primary-nav [aria-current="page"]')?.textContent,label:document.querySelector('.detail-top>span')?.textContent,accessible:document.querySelector('.detail-panel')?.getAttribute('aria-label')}));
  await page.screenshot({path:out+`/pending-${width}.png`});release();await page.locator('.entity-heading h1').waitFor();
  const loaded=await page.evaluate(()=>({path:location.pathname,active:document.querySelector('.primary-nav [aria-current="page"]')?.textContent,label:document.querySelector('.detail-top>span')?.textContent}));samples.push({width,pending,loaded});await context.close();
 }
}finally{await browser.close();writeFileSync(out+'/report.json',JSON.stringify({samples,errors},null,2));console.log(JSON.stringify({samples,errors},null,2));}
assert.deepEqual(errors,[]);assert.ok(samples.every(s=>s.pending.path==='/organizations'&&s.loaded.path==='/organizations'&&s.pending.active==='组织'&&s.loaded.active==='组织'&&s.pending.label.startsWith('组织档案')&&s.loaded.label.startsWith('组织档案')&&s.pending.accessible==='组织档案详情'),'organization identity must remain stable from click through response');
