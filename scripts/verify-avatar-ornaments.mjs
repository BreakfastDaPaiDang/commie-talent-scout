import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

const ids=['12-collective-forward','15-common-record','25-steps-on-map','28-pages-to-flag','30-connected-line','35-star-eye-imprint'];
const v=await verificationClient('avatar-ornaments'),checks=[],out=`tmp/verification/avatar-ornaments-${v.target}`;mkdirSync(out,{recursive:true});
let browser,archive;
try{
 archive=await v.call('create_archive',{type:'person',name:'虚构头像验收 '+randomUUID().slice(0,6),contacts:[{type:'邮箱',value:'avatar@example.invalid',note:''}],request_id:randomUUID()});
 const png=readFileSync('tests/fixtures/images/shapes.png'),ticket=await v.call('prepare_image_upload',{purpose:'archive_avatar',archive_id:archive.id,mime_type:'image/png',byte_size:png.length,sha256:createHash('sha256').update(png).digest('hex')});
 assert.equal((await fetch(ticket.url,{method:'PUT',headers:ticket.headers,body:png})).status,200);
 const current=(await v.call('get_archive',{id:archive.id})).archive;
 assert.equal((await v.http('/avatars/set',{subject_type:'archive',id:archive.id,expected_version:current.version,attachment_id:ticket.attachment_id,request_id:randomUUID()})).status,200);
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 for(let i=0;i<ids.length;i++){
  const context=await browser.newContext({viewport:{width:1920,height:1000}}),[name,...value]=v.sessionCookie.split('=');
  await context.addCookies([{name,value:value.join('='),url:v.base}]);await context.addInitScript(seed=>Math.random=()=>seed,(i+.5)/ids.length);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(v.base+'/?archive='+archive.id,{waitUntil:'domcontentloaded'});await page.locator('.entity-avatar > .avatar img').waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>{const image=document.querySelector('.entity-avatar > .avatar img');return image?.complete&&image.naturalWidth>0;});
  const ornament=page.locator('.avatar-ornament');assert.equal(await ornament.getAttribute('data-ornament'),ids[i]);
  const decoded=await page.evaluate(async id=>{const image=new Image();image.src=`/art/avatar-ornaments/${id}.png`;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let clear=0,ink=0;for(let i=3;i<data.length;i+=4){if(data[i]===0)clear++;if(data[i]>128)ink++;}return {clear,ink};},ids[i]);assert.ok(decoded.clear>1000&&decoded.ink>1000);
  const served=await page.evaluate(async id=>{const r=await fetch(`/art/avatar-ornaments/${id}.png`),bytes=await r.arrayBuffer();return {type:r.headers.get('content-type'),hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('')};},ids[i]);assert.match(served.type,/^image\/png/);assert.equal(served.hash,createHash('sha256').update(readFileSync(`public/art/avatar-ornaments/${ids[i]}.png`)).digest('hex'));
  assert.equal(await ornament.evaluate(e=>getComputedStyle(e).display),'block');assert.equal(await ornament.evaluate(e=>getComputedStyle(e).pointerEvents),'none');
  assert.ok(await ornament.evaluate(e=>e.getBoundingClientRect().bottom<=e.closest('.entity-header').getBoundingClientRect().bottom+1),'decoration must end before the tabs and composer');
  assert.equal(await page.locator('.entity-avatar > .avatar').evaluate(e=>getComputedStyle(e).opacity),'1');
  await page.screenshot({path:`${out}/${ids[i]}.png`});
  // Changing future random values cannot disturb the currently mounted detail.
  await page.evaluate(()=>Math.random=()=>.99);
  await page.getByRole('button',{name:'编辑档案',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
  await page.getByRole('textbox',{name:'新的观察记录',exact:true}).fill('未提交的虚构观察');
  assert.equal(await ornament.getAttribute('data-ornament'),ids[i]);
  for(const width of [1440,1100,1024,768,390]){
   await page.setViewportSize({width,height:width<600?844:1000});
   const measured=await ornament.evaluate(e=>({shown:getComputedStyle(e).display==='block',header:e.closest('.entity-header').clientWidth,overflow:document.documentElement.scrollWidth>innerWidth}));
   assert.equal(measured.shown,width>=1100&&measured.header>=760);assert.equal(measured.overflow,false);
  }
  if(i===0)await page.screenshot({path:out+'/mobile-composer.png'});
  await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'展开阅读视图',exact:true}).click();assert.equal(await ornament.evaluate(e=>getComputedStyle(e).display),'block');assert.equal(await ornament.getAttribute('data-ornament'),ids[i]);
  await page.waitForFunction(()=>{const e=document.querySelector('.avatar-ornament');return e.getBoundingClientRect().bottom<=e.closest('.entity-header').getBoundingClientRect().bottom+1;});
  if(i===0)await page.screenshot({path:out+'/expanded-composer.png'});
  assert.deepEqual(errors,[]);await context.close();
 }
 checks.push('all six selections load real transparent PNG bytes against staging and keep the original colored avatar','editing, composing and resizing retain the draw; 5 narrow widths and expanded reading obey available header space');
 const context=await browser.newContext({viewport:{width:390,height:844}}),[name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage(),artRequests=[];page.on('request',r=>{if(r.url().includes('/art/avatar-ornaments/'))artRequests.push(r.url());});await page.goto(v.base+'/?archive='+archive.id,{waitUntil:'domcontentloaded'});await page.locator('.entity-avatar > .avatar img').waitFor();await page.getByRole('button',{name:'编辑档案',exact:true}).click();await page.getByRole('dialog').waitFor();await page.screenshot({path:out+'/mobile-editor.png'});assert.deepEqual(artRequests,[]);await context.close();checks.push('fresh mobile load requests no ornament assets and retains the complete editor');
}finally{
 try{
  if(browser)await browser.close();
  if(archive){const current=(await v.call('get_archive',{id:archive.id})).archive;await v.call('delete_archive',{id:archive.id,expected_version:current.version,request_id:randomUUID()});}
 }finally{await v.close(checks);}
}
