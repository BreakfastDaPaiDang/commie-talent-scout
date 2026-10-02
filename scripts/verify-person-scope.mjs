import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

// Synthetic archives only: real local/staging HTTP, MCP, persisted tasks and shared UI.
const v=await verificationClient('person-scope'),checks=[],created=[];let browser;
async function listed(person_scope,query){return v.call('list_archives',{type:'person',person_scope,query});}
async function waitList(page,scope,query,action){
 const response=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/archives'&&u.searchParams.get('person_scope')===scope&&u.searchParams.get('query')===query;});
 await action();assert.equal((await response).status(),200);
}
async function openList(page,path){
 await page.goto(v.base+path);await page.locator('.archive-head').waitFor({state:'attached'});
 const close=page.getByRole('button',{name:'关闭档案详情',exact:true});if(await close.isVisible())await close.click();
}
try{
 mkdirSync('tmp/verification',{recursive:true});
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext({timezoneId:'Asia/Shanghai'}),[cookieName,...cookieValue]=v.sessionCookie.split('=');
 await context.addCookies([{name:cookieName,value:cookieValue.join('='),url:v.base}]);const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});const name='虚构社员范围 '+width+' '+randomUUID().slice(0,8);
  await openList(page,'/members');await page.getByRole('button',{name:'新建',exact:true}).click();
  const form=page.getByRole('dialog',{name:'新建社员档案',exact:true});await form.getByRole('textbox',{name:'昵称',exact:true}).fill(name);
  const creation=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/archives/create');await form.getByRole('button',{name:'创建档案',exact:true}).click();
  const result=await (await creation).json();assert.ok(result.id);created.push(result.id);await form.waitFor({state:'detached'});
  const archive=(await v.call('get_archive',{id:result.id})).archive;assert.equal(archive.status,'已入伙');assert.equal(archive.closed,false);
  assert.equal((await listed('members',name)).counts.all,1);assert.equal((await listed('external',name)).counts.all,0);
  await openList(page,'/members');await waitList(page,'members',name,()=>page.getByRole('textbox',{name:'搜索档案',exact:true}).fill(name));await page.locator('.entity-row').filter({hasText:name}).waitFor();
  await page.screenshot({path:`tmp/verification/person-scope-${v.target}-members-${width}.png`});
  await openList(page,'/');await waitList(page,'external',name,()=>page.getByRole('textbox',{name:'搜索档案',exact:true}).fill(name));await page.waitForFunction(()=>document.querySelectorAll('.entity-row').length===0);
  await page.screenshot({path:`tmp/verification/person-scope-${v.target}-external-${width}.png`});
  await page.goto(v.base+'/?archive='+result.id);await page.locator('.entity-heading h1').filter({hasText:name}).waitFor();assert.equal(await page.locator('.entity-heading h1').textContent(),name);
  checks.push(`${width}px: direct member creation remains open, appears only in member list/counts, and its original direct link still works`);
 }
 await page.setViewportSize({width:390,height:844});
 const external=await v.call('create_archive',{type:'person',name:'虚构审核撤回 '+randomUUID().slice(0,8),status:'个人接触',request_id:randomUUID()});created.push(external.id);
 await page.goto(v.base+'/?archive='+external.id);await page.getByRole('button',{name:'提交人事审核',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.entity-heading .state-badge')?.textContent==='人事审核');
 const tasks=(await v.call('list_work_tasks',{archive_id:external.id})).tasks;assert.equal(tasks.length,1);
 await page.getByRole('button',{name:'编辑档案',exact:true}).click();const editor=page.getByRole('dialog',{name:'编辑档案',exact:true});
 await editor.getByRole('tab',{name:'状态与成员',exact:true}).click();await editor.getByRole('radio',{name:'个人接触',exact:true}).check();
 assert.ok(await editor.getByRole('button',{name:'保存状态与成员',exact:true}).isVisible());assert.ok(await editor.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
 await page.screenshot({path:`tmp/verification/person-scope-${v.target}-withdraw-mobile.png`});
 await editor.getByRole('button',{name:'保存状态与成员',exact:true}).click();await editor.waitFor({state:'detached'});
 await page.waitForFunction(()=>document.querySelector('.entity-heading .state-badge')?.textContent==='个人接触');
 assert.equal((await v.call('get_archive',{id:external.id})).archive.status,'个人接触');assert.equal((await v.call('list_work_tasks',{archive_id:external.id})).tasks.length,0);
 const cancelled=await v.http('/work-tasks/'+tasks[0].id);assert.equal(cancelled.status,200);assert.equal(cancelled.body.task.status,'cancelled');assert.equal(cancelled.body.events[0].kind,'task.cancelled');assert.match(cancelled.body.events[0].reason,/撤回人事审核/);
 checks.push('390px: real referral followed by state withdrawal cancels the persisted automatic audit task, preserving cancellation history across HTTP and MCP');
 const current=(await v.call('get_archive',{id:external.id})).archive,referral=await v.call('refer_archive',{archive_id:external.id,expected_version:current.version,deadline_at:new Date(Date.now()+86400000).toISOString(),request_id:randomUUID()});
 const cancelledTask=await v.call('cancel_work_task',{id:referral.task_id,expected_version:1,reason:'虚构验收：取消本次审核并保留个人接触',request_id:randomUUID()});assert.equal(cancelledTask.archive_status,'个人接触');
 await page.reload();await page.waitForFunction(()=>document.querySelector('.entity-heading .state-badge')?.textContent==='个人接触');assert.equal((await v.call('get_archive',{id:external.id})).archive.status,'个人接触');
 checks.push('MCP task cancellation restores the recorded prior contact relationship, and the reloaded web archive agrees');
 assert.deepEqual(errors,[]);console.log('PASS: member/external ranges and audit withdrawal through real interfaces at desktop/mobile widths');
}finally{
 try{if(browser)await browser.close();for(const id of created){const a=(await v.call('get_archive',{id})).archive;if(!a.closed)await v.call('set_archive_state',{id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:randomUUID()});const latest=(await v.call('get_archive',{id})).archive;await v.call('delete_archive',{id,expected_version:latest.version,request_id:randomUUID()});}}
 finally{await v.close(checks);}
}
