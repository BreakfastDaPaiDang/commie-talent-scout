import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

assert.ok(!process.argv.includes('--production'),'lifecycle verification uses isolated staging only');
const v=await verificationClient('archive-lifecycle'),checks=[],out='tmp/verification/archive-lifecycle';
let browser,page,archive;
const get=async()=>(await v.call('get_archive',{id:archive.id})).archive;
const events=async()=>(await v.call('list_archive_events',{id:archive.id,limit:100})).events;
const input=(a,status)=>({id:a.id,expected_version:a.version,status,member_ids:[],request_id:uuid()});
async function capture(name){
 await page.evaluate(()=>document.fonts.ready);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(await page.getByRole('dialog').count())assert.ok(await page.getByRole('dialog').last().evaluate(e=>e.scrollWidth<=e.clientWidth+1));
 await page.screenshot({path:out+'/'+name+'.png'});
}
try{
 mkdirSync(out,{recursive:true});
 archive=await v.call('create_archive',{type:'person',name:'虚构规则验收 '+uuid().slice(0,8),request_id:uuid()});
 await v.call('create_observation',{archive_id:archive.id,body:'虚构公开作品观察，保留在同一档案中。',request_id:uuid()});
 const category=await v.call('create_tag_category',{type:'person',name:'虚构规则类别 '+uuid().slice(0,8),request_id:uuid()});
 const tag=await v.call('create_tag',{category_id:category.id,name:'虚构原词义',description:'关闭前的含义',request_id:uuid()});
 await v.call('update_archive_tags',{archive_id:archive.id,expected_version:(await get()).version,changes:[{tag_id:tag.id,action:'add',evidence:[{kind:'member_instruction',note:'仅用于虚构档案的关闭快照验收'}]}],request_id:uuid()});
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
 const [name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);
 page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(v.base+'/?archive='+archive.id);await page.locator('.record-body').filter({hasText:'虚构公开作品观察'}).waitFor();
 await page.getByRole('button',{name:'编辑档案',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'编辑档案',exact:true});
 await dialog.getByRole('tab',{name:'状态与成员',exact:true}).click();
 await dialog.getByRole('radio',{name:'已弃用',exact:true}).check();await capture('desktop-close');
 const sent=page.waitForRequest(r=>r.url().endsWith('/api/archives/state')&&r.method()==='POST');
 await dialog.getByRole('button',{name:'保存并关闭档案',exact:true}).click();
 const closeRequest=(await sent).postDataJSON();await dialog.waitFor({state:'detached'});
 await page.getByRole('button',{name:'重新开启',exact:true}).waitFor();
 let a=await get();assert.equal(a.closed,true);assert.equal(a.status,'已弃用');
 assert.equal(a.tags[0].description,'关闭前的含义');const afterClose=(await events()).length;
 assert.equal((await v.call('set_archive_state',closeRequest)).replayed,true);assert.equal((await events()).length,afterClose);
 const locked=await v.http('/archives/state',input(a,'个人接触'));assert.equal(locked.status,409);assert.equal(locked.body.error.code,'ARCHIVE_CLOSED');
 checks.push('desktop web closes the same archive as 已弃用; MCP replay adds no history; ordinary write cannot reopen it');

 const preview=await v.call('preview_tag_definition',{change:{entity_type:'tag',id:tag.id,category_id:category.id,name:'虚构原词义',description:'重开后读取的新含义',reason:'虚构规则验收'}});
 await v.call('apply_tag_definition',{preview_id:preview.preview_id,request_id:uuid()});
 assert.equal((await get()).tags[0].description,'关闭前的含义');
 const reopenRequest=input(a,'个人接触'),opened=await v.call('reopen_archive',reopenRequest);
 assert.equal(opened.closed,false);assert.equal(opened.definition_changes.length,1);
 assert.equal((await v.http('/archives/reopen',reopenRequest)).body.replayed,true);
 assert.equal((await get()).tags[0].description,'重开后读取的新含义');
 const stale=await v.http('/archives/state',input(a,'已弃用'));assert.equal(stale.status,409);assert.equal(stale.body.error.code,'VERSION_CONFLICT');
 await page.reload();await page.getByRole('textbox',{name:'新的观察记录',exact:true}).waitFor();
 checks.push('MCP explicitly reopens; web replay stays idempotent, old version is rejected, closed tag snapshot and reopening definition diff survive');

 a=await get();const secondClose=input(a,'已弃用');await v.call('set_archive_state',secondClose);
 await page.setViewportSize({width:390,height:844});await page.reload();await page.getByRole('button',{name:'重新开启',exact:true}).click();
 dialog=page.getByRole('dialog').last();await dialog.getByRole('radio',{name:'个人接触',exact:true}).check();await capture('mobile-reopen');
 const sentReopen=page.waitForRequest(r=>r.url().endsWith('/api/archives/reopen')&&r.method()==='POST');
 await dialog.getByRole('button',{name:'重新开启档案',exact:true}).click();const mobileRequest=(await sentReopen).postDataJSON();await dialog.waitFor({state:'detached'});
 await page.getByRole('textbox',{name:'新的观察记录',exact:true}).waitFor();
 const afterReopen=(await events()).length;assert.equal((await v.call('reopen_archive',mobileRequest)).replayed,true);assert.equal((await events()).length,afterReopen);
 assert.equal((await get()).closed,false);await capture('mobile-opened');
 const history=await events();assert.equal(history.filter(e=>e.kind==='archive.closed').length,2);assert.equal(history.filter(e=>e.kind==='archive.reopened').length,2);
 assert.deepEqual(history.filter(e=>e.kind==='archive.closed').map(e=>e.source),['mcp','web']);
 assert.deepEqual(history.filter(e=>e.kind==='archive.reopened').map(e=>e.source),['web','mcp']);assert.deepEqual(errors,[]);
 checks.push('MCP closes then mobile web reopens the same ID; exact two close/two reopen events retain actor/source with no duplicate history or page errors');
}catch(error){if(page)await page.screenshot({path:out+'/failure.png'});throw error;}
finally{
 if(browser)await browser.close();
 if(archive){let a=await get();if(!a.closed)await v.call('set_archive_state',input(a,'已弃用'));a=await get();await v.call('delete_archive',{id:a.id,expected_version:a.version,request_id:uuid()});}
 await v.close(checks);
}
