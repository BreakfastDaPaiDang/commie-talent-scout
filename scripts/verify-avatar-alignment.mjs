import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
import {fixture,archives,errors} from './ui-review-fixtures.mjs';

// Art-directed empty-space centers, measured against the full source PNG.
const art=[['12-collective-forward',1.5,.50,.45],['15-common-record',2,.54,.35],['25-steps-on-map',1.5,.50,.48],['28-pages-to-flag',2,.55,.56],['30-connected-line',1.5,.50,.48],['35-star-eye-imprint',2,.66,.40]];
const out='tmp/verification/avatar-alignment';mkdirSync(out,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:8793,strictPort:true}}),browser=await chromium.launch({channel:'msedge',headless:true}),checks=[];
try{
 for(const [i,[id,aspect,ax,ay]] of art.entries()){
  assert.ok(readFileSync(`public/art/avatar-ornaments/${id}.webp`).length<128*1024,'ornament delivery must stay below 128 KiB');
  const context=await browser.newContext({viewport:{width:1920,height:1000}});await context.addInitScript(seed=>Math.random=()=>seed,(i+.5)/art.length);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',fixture);await page.route('**/avatars/**',r=>r.fulfill({path:'tests/fixtures/images/shapes.png',contentType:'image/png'}));
  for(const [scenario,name,width] of [['short','Maki',1920],['compact','端wood赐',1660],['long','美国民主社会主义者（DSA）',1920],['mobile','Maki',390]]){
   await page.setViewportSize({width,height:1000});archives[0].name=name;await page.goto('http://127.0.0.1:8793/?archive='+archives[0].id,{waitUntil:'domcontentloaded'});await page.locator('.entity-avatar img').waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(60);
   if(scenario==='short'){const decoded=await page.evaluate(async id=>{const image=new Image();image.src=`/art/avatar-ornaments/${id}.webp`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,image.width,image.height).data;let clear=0,ink=0;for(let i=3;i<rgba.length;i+=4){if(rgba[i]===0)clear++;if(rgba[i]>128)ink++;}return {width:image.width,height:image.height,clear,ink};},id);assert.equal(decoded.width,720);assert.equal(decoded.width/decoded.height,aspect);assert.ok(decoded.clear>1000&&decoded.ink>1000);}
   const geometry=await page.locator('.avatar-ornament').evaluate((e,{aspect,ax,ay})=>{
    const r=e.getBoundingClientRect(),avatar=e.closest('.entity-avatar').querySelector('.avatar').getBoundingClientRect(),header=e.closest('.entity-header'),heading=header.querySelector('.entity-heading').getBoundingClientRect(),button=header.querySelector('.archive-edit-entry').getBoundingClientRect();
    const width=Math.min(r.width,r.height*aspect),height=width/aspect;
    return {shown:getComputedStyle(e).display!=='none',dx:r.left+(r.width-width)/2+width*ax-(avatar.left+avatar.width/2),dy:r.top+(r.height-height)/2+height*ay-(avatar.top+avatar.height/2),clear:r.right<=button.left-8&&r.left>=heading.right+8,bottom:r.bottom<=header.getBoundingClientRect().bottom+1};
   },{aspect,ax,ay});
   const expectedVisible=scenario==='short'||scenario==='compact';
   checks.push({id,scenario,...geometry,ok:geometry.shown===expectedVisible&&(!geometry.shown||Math.abs(geometry.dx)<1&&Math.abs(geometry.dy)<1&&geometry.clear&&geometry.bottom)});
   await page.screenshot({path:`${out}/${id}-${scenario}.png`});
  }
  await context.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));}
console.log(JSON.stringify({checks,errors},null,2));assert.ok(checks.every(c=>c.ok)&&!errors.length,'avatar must occupy the art-specific center with clear controls');
