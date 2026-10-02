import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

// Keep the historical entry point, now verifying that avatar decorations are gone.
const v=await verificationClient('avatar-ornaments'),checks=[],out=`tmp/verification/avatar-ornaments-${v.target}`;mkdirSync(out,{recursive:true});
let browser,archive;
try{
 archive=await v.call('create_archive',{type:'person',name:'头像 '+randomUUID().slice(0,4),contacts:[{type:'邮箱',value:'avatar@example.invalid',note:''}],request_id:randomUUID()});
 const png=readFileSync('tests/fixtures/images/shapes.png'),ticket=await v.call('prepare_image_upload',{purpose:'archive_avatar',archive_id:archive.id,mime_type:'image/png',byte_size:png.length,sha256:createHash('sha256').update(png).digest('hex')});
 assert.equal((await fetch(ticket.url,{method:'PUT',headers:ticket.headers,body:png})).status,200);
 const current=(await v.call('get_archive',{id:archive.id})).archive;
 assert.equal((await v.http('/avatars/set',{subject_type:'archive',id:archive.id,expected_version:current.version,attachment_id:ticket.attachment_id,request_id:randomUUID()})).status,200);
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1920,height:1000}}),[name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);
 const page=await context.newPage(),errors=[],artRequests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/art/avatar-ornaments/'))artRequests.push(r.url());});
 for(const width of [1920,1440,1100,1024,768,390]){
  await page.setViewportSize({width,height:width<600?844:1000});await page.goto(v.base+'/?archive='+archive.id,{waitUntil:'domcontentloaded'});
  await page.locator('.entity-avatar > .avatar img').waitFor();await page.waitForFunction(()=>{const image=document.querySelector('.entity-avatar img');return image?.complete&&image.naturalWidth>0;});
  assert.equal(await page.locator('.avatar-ornament,.avatar-composition,[data-ornament-fits]').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`${out}/plain-avatar-${width}.png`});
 }
 await page.getByRole('button',{name:'编辑档案',exact:true}).click();await page.getByRole('dialog').waitFor();await page.screenshot({path:out+'/mobile-editor.png'});await page.keyboard.press('Escape');
 await page.getByRole('textbox',{name:'新的观察记录',exact:true}).fill('未提交的虚构观察');await page.screenshot({path:out+'/mobile-composer.png'});
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'展开阅读视图',exact:true}).click();assert.equal(await page.locator('.entity-avatar > .avatar img').isVisible(),true);assert.equal(await page.locator('.avatar-ornament').count(),0);await page.screenshot({path:out+'/expanded-composer.png'});
 assert.deepEqual(artRequests,[]);assert.deepEqual(errors,[]);await context.close();checks.push('uploaded avatar remains visible at six widths without ornament elements or requests','mobile editing, composing and expanded reading remain usable');
}finally{
 try{if(browser)await browser.close();if(archive){const current=(await v.call('get_archive',{id:archive.id})).archive;await v.call('delete_archive',{id:archive.id,expected_version:current.version,request_id:randomUUID()});}}
 finally{await v.close(checks);}
}
