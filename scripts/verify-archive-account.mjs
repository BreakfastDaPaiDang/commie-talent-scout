import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('archive-account'),checks=[];let accountId,archiveId,browser;
const get=async()=> (await v.call('get_archive',{id:archiveId})).archive;
try{
 const created=await v.http('/admin/members/create',{username:'link-'+uuid().slice(0,8),name:'虚构账号昵称',qq:'123456789',role:'member',temporary_password:uuid()+'Aa9!',request_id:uuid()});assert.equal(created.status,200);accountId=created.body.id;
 archiveId=(await v.call('create_archive',{type:'person',status:'已入伙',name:'名单别名',linked_account_id:accountId,contacts:[{type:'QQ',value:'123456789',note:'名单称呼：虚构别名'}],request_id:uuid()})).id;
 assert.equal((await get()).name,'虚构账号昵称');assert.deepEqual((await get()).members,[]);
 const renamed=await v.http('/admin/members/profile',{id:accountId,expected_version:1,name:'虚构同步昵称',qq:'123456789',request_id:uuid()});assert.equal(renamed.status,200);assert.equal((await get()).name,'虚构同步昵称');checks.push('HTTP account rename and MCP archive share a stable identity, independent of responsibility');
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});const context=await browser.newContext(),[name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(v.base+'/members?archive='+archiveId);await page.getByRole('button',{name:'编辑档案',exact:true}).click();const editor=page.getByRole('dialog',{name:'编辑档案',exact:true});
  assert.equal(await editor.getByLabel('昵称',{exact:true}).inputValue(),'虚构同步昵称');assert.equal(await editor.getByLabel('昵称',{exact:true}).evaluate(e=>e.readOnly),true);
  assert.ok(await editor.getByText('昵称跟随本人猎头账号，请在账号资料中修改。',{exact:true}).isVisible());
  await editor.getByPlaceholder('记录对象当前需要的帮助、资源或协作，可留空',{exact:true}).fill('虚构资料编辑 '+width);assert.ok(await editor.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:`tmp/verification/archive-account-${width}.png`,fullPage:true});await editor.getByRole('button',{name:'保存资料',exact:true}).click();await editor.waitFor({state:'detached'});assert.equal((await get()).current_need,'虚构资料编辑 '+width);checks.push(`${width}px shared full editor locks linked name and saves other profile fields`);
 }
 assert.deepEqual(errors,[]);
}finally{
 try{if(browser)await browser.close();if(archiveId){let a=await get();await v.call('update_archive',{id:a.id,expected_version:a.version,name:a.name,contacts:a.contacts,links:a.links,linked_account_id:null,request_id:uuid()});a=await get();await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'已弃用',membership_action:'leave',member_ids:[],request_id:uuid()});a=await get();await v.call('delete_archive',{id:a.id,expected_version:a.version,request_id:uuid()});}if(accountId){const a=(await v.http('/admin/members/'+accountId)).body.member;assert.equal((await v.http('/admin/members/frozen',{id:a.id,expected_version:a.version,frozen:true,request_id:uuid()})).status,200);}}
 finally{await v.close(checks);}
}
