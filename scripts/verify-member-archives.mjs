import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

const v=await verificationClient('member-archives'),checks=[],created=[];let browser;
const get=async id=>(await v.call('get_archive',{id})).archive;
const state=async(id,status,extra={})=>v.call('set_archive_state',{id,expected_version:(await get(id)).version,status,member_ids:[],request_id:randomUUID(),...extra});
try{
 mkdirSync('tmp/verification',{recursive:true});
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext({timezoneId:'Asia/Shanghai'}),[name,...value]=v.sessionCookie.split('=');
 await context.addCookies([{name,value:value.join('='),url:v.base}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  const name='虚构社员档案验收 '+width+' '+randomUUID().slice(0,8);
  const a=await v.call('create_archive',{type:'person',name,status:'个人接触',request_id:randomUUID()});created.push(a.id);
  await state(a.id,'人事审核');await state(a.id,'已加入待对接');
  assert.equal((await v.call('list_archives',{type:'person',person_scope:'external',query:name})).counts.all,1);
  assert.equal((await v.call('list_archives',{type:'person',person_scope:'members',query:name})).counts.all,0);
  const tasks=(await v.call('list_work_tasks',{archive_id:a.id})).tasks;assert.equal(tasks.length,2);assert.ok(tasks.every(t=>t.status==='open'));
  await page.goto(v.base+'/?archive='+a.id);
  await page.getByRole('button',{name:'编辑档案',exact:true}).click();
  await page.getByRole('dialog',{name:'编辑档案',exact:true}).getByRole('tab',{name:'状态与成员',exact:true}).click();
  await page.getByRole('dialog',{name:'编辑档案',exact:true}).getByRole('radio',{name:'已入伙',exact:true}).check();
  await page.getByRole('dialog',{name:'编辑档案',exact:true}).getByRole('button',{name:'保存状态与成员',exact:true}).click();
  await page.waitForURL('**/members?archive='+a.id);
  await page.waitForFunction(()=>document.querySelector('.entity-heading .state-badge')?.textContent==='可接工作');
  assert.equal((await get(a.id)).closed,false);
  await page.getByRole('button',{name:'编辑档案',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'编辑档案',exact:true});
  await page.screenshot({path:`tmp/verification/member-archives-profile-${width}.png`});
  await editor.getByRole('tab',{name:'状态与成员',exact:true}).click();
  for(const label of ['可接工作','请假','失联'])assert.ok(await editor.getByRole('radio',{name:label,exact:true}).isVisible());
  assert.equal(await editor.getByRole('radio',{name:'已入伙',exact:true}).count(),0);
  await editor.getByRole('radio',{name:'请假',exact:true}).check();
  await editor.getByText('变更社员身份',{exact:true}).click();
  assert.ok(await editor.getByRole('combobox',{name:'身份变更',exact:true}).isVisible());
  assert.ok(await editor.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:`tmp/verification/member-archives-state-${width}.png`});
  await editor.getByRole('button',{name:'保存状态与成员',exact:true}).click();await editor.waitFor({state:'detached'});
  await page.waitForFunction(()=>document.querySelector('.entity-heading .state-badge')?.textContent==='请假');
  assert.equal((await get(a.id)).member_status,'请假');
  assert.equal((await v.call('list_archives',{type:'person',person_scope:'members',member_status:'请假',query:name})).counts.all,1);
  await page.screenshot({path:`tmp/verification/member-archives-detail-${width}.png`});
  await page.getByRole('button',{name:'编辑档案',exact:true}).click();await editor.getByRole('tab',{name:'状态与成员',exact:true}).click();
  await editor.getByText('变更社员身份',{exact:true}).click();await editor.getByRole('combobox',{name:'身份变更',exact:true}).selectOption('to_friend');
  await editor.getByRole('button',{name:'转为外部社友',exact:true}).click();await page.waitForURL('**/?archive='+a.id);
  await page.waitForFunction(()=>document.querySelector('.entity-heading .state-badge')?.textContent==='外部社友');
  assert.equal((await get(a.id)).person_role,'external');assert.equal((await get(a.id)).closed,false);
  checks.push(`${width}px: HTTP/MCP stage tasks, pending remains external, same-ID join, basic state edit, expanded profile/identity forms, explicit return to external`);
 }
 assert.deepEqual(errors,[]);checks.push('No browser runtime errors');
 console.log('PASS: member profile desktop/mobile through real local HTTP and MCP');
}finally{
 try{if(browser)await browser.close();for(const id of created){const a=await get(id);if(!a.closed)await state(id,'已弃用',a.person_role==='member'?{membership_action:'leave'}:{});await v.call('delete_archive',{id,expected_version:(await get(id)).version,request_id:randomUUID()});}}
 finally{await v.close(checks);}
}
