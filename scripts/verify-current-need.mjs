import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

const v=await verificationClient('current-need'),created=[],checks=[];let browser;
try{
 const name='\u865a\u6784\u9700\u6c42\u9a8c\u6536 '+randomUUID().slice(0,8);
 const archive=await v.call('create_archive',{type:'person',name,status:'\u5df2\u5165\u4f19',member_ids:[v.actor.id],current_need:'\u521d\u59cb\u9700\u6c42',contacts:[{type:'QQ',value:'123456789',note:''}],request_id:randomUUID()});created.push(archive.id);
 const initial=await v.call('get_archive',{id:archive.id});assert.equal(initial.archive.current_need,'\u521d\u59cb\u9700\u6c42');assert.equal(initial.archive.contact_reminder.needed,true);checks.push('MCP create/get exposes current_need and contact_reminder');
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'}),[cookieName,...cookieValue]=v.sessionCookie.split('=');await context.addCookies([{name:cookieName,value:cookieValue.join('='),url:v.base}]);const page=await context.newPage();
 await page.goto(v.base+'/?archive='+archive.id,{waitUntil:'domcontentloaded'});await page.getByText('\u521d\u59cb\u9700\u6c42',{exact:true}).waitFor();await page.getByRole('button',{name:'\u7f16\u8f91\u6863\u6848',exact:true}).click();const editor=page.getByRole('dialog',{name:'\u7f16\u8f91\u6863\u6848',exact:true});
 await editor.getByRole('textbox',{name:'\u5f53\u524d\u9700\u6c42',exact:true}).fill('\u7f51\u9875\u8bb0\u5f55\u7684\u660e\u786e\u9700\u6c42');await editor.getByRole('button',{name:/\u6dfb\u52a0\u8054\u7cfb\u65b9\u5f0f/}).click();await editor.locator('select[aria-label="\u8054\u7cfb\u65b9\u5f0f2\u7c7b\u578b"]').selectOption('\u90ae\u7bb1');await editor.locator('input[aria-label="\u8054\u7cfb\u65b9\u5f0f2"]').fill('need@example.invalid');await editor.getByRole('button',{name:'\u4fdd\u5b58\u8d44\u6599',exact:true}).click();await editor.waitFor({state:'detached'});
 const updated=await v.call('get_archive',{id:archive.id});assert.equal(updated.archive.current_need,'\u7f51\u9875\u8bb0\u5f55\u7684\u660e\u786e\u9700\u6c42');assert.equal(updated.archive.contact_reminder.needed,false);checks.push('shared archive editor writes current_need and a second distinct contact');
 const preserved=await v.call('update_archive',{id:archive.id,expected_version:updated.archive.version,name:updated.archive.name,contacts:updated.archive.contacts,links:updated.archive.links,request_id:randomUUID()});assert.equal(preserved.contact_reminder.needed,false);assert.equal((await v.call('get_archive',{id:archive.id})).archive.current_need,'\u7f51\u9875\u8bb0\u5f55\u7684\u660e\u786e\u9700\u6c42');checks.push('MCP update without current_need preserves the existing value');

}finally{if(browser)await browser.close();for(const id of created){const current=(await v.call('get_archive',{id})).archive;if(!current.closed)await v.call('set_archive_state',{id,expected_version:current.version,status:'\u5df2\u5f03\u7528',member_ids:[],request_id:randomUUID()});const latest=(await v.call('get_archive',{id})).archive;await v.call('delete_archive',{id,expected_version:latest.version,request_id:randomUUID()});}await v.close(checks);}
