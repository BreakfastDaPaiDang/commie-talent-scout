import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

const v=await verificationClient('archive-related-tasks'),checks=[],created=[];let browser;
const get=async id=>(await v.call('get_archive',{id})).archive;
try{
 mkdirSync('tmp/verification',{recursive:true});
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext({timezoneId:'Asia/Shanghai'}),[cookieName,...cookieValue]=v.sessionCookie.split('=');
 await context.addCookies([{name:cookieName,value:cookieValue.join('='),url:v.base}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [type,status,path] of [['person','个人接触','/'],['person','已入伙','/members'],['org','视奸观察','/organizations']]){
  const a=await v.call('create_archive',{type,status,name:'虚构关联任务 '+status+' '+randomUUID().slice(0,8),request_id:randomUUID()});created.push(a.id);
  const tasks=[];for(const title of ['核对当前进展','补充接触记录','历史工作'])tasks.push(await v.call('create_work_task',{archive_id:a.id,kind:'custom',title,purpose:'了解当前情况并留下记录',delivery:'把实际结果写入档案',deadline_at:new Date(Date.now()+7*86400000).toISOString(),request_id:randomUUID()}));
  await v.call('cancel_work_task',{id:tasks[2].id,expected_version:tasks[2].version,reason:'虚构验收历史',request_id:randomUUID()});
  const obs=await v.call('create_observation',{archive_id:a.id,body:'虚构关联任务验收的观察内容',request_id:randomUUID()});
  const width=path==='/'?1440:390;await page.setViewportSize({width,height:width===390?844:1000});
  await page.goto(v.base+path+'?archive='+a.id);
  await page.locator('.related-tasks h3').filter({hasText:'2 项开启'}).waitFor();assert.equal(await page.getByRole('tab',{name:/关联任务/}).count(),0);assert.equal(await page.getByText('下一步工作',{exact:true}).count(),0);
  const composer=page.locator('.live-composer-form');await composer.getByRole('button',{name:'开始撰写观察',exact:true}).click();await composer.locator('textarea').fill('未提交的观察草稿');
  await page.locator('.related-tasks .task-list-row').first().waitFor();assert.equal(await page.locator('.related-tasks .task-list-row').count(),2);assert.equal(await page.locator('.related-tasks').getByText('历史工作',{exact:true}).count(),0);
  assert.ok(await page.locator('.timeline-tabs').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'timeline tabs overflow');
  await page.screenshot({path:`tmp/verification/related-tasks-${type}-${width}-list.png`});
  await page.getByRole('tab',{name:'绑定材料',exact:false}).click();await page.getByRole('tab',{name:'全部动态',exact:true}).click();assert.equal(await composer.locator('textarea').inputValue(),'未提交的观察草稿');
  await page.locator('.related-tasks .task-index-item').filter({hasText:'核对当前进展'}).click();
  const modal=page.getByRole('dialog',{name:'任务详情',exact:true});await modal.getByRole('button',{name:'领取任务',exact:true}).click();await modal.getByRole('button',{name:'提交交付',exact:true}).waitFor();
  await modal.getByRole('button',{name:'编辑任务',exact:true}).click();const edit=page.getByRole('dialog',{name:'编辑任务',exact:true});await edit.getByRole('textbox',{name:'任务目的',exact:true}).fill('已核对，准备留存结果');
  assert.ok(await edit.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:`tmp/verification/related-tasks-${type}-${width}-editor.png`});await edit.getByRole('button',{name:'保存任务',exact:true}).click();await edit.waitFor({state:'detached'});await modal.getByText('已核对，准备留存结果',{exact:true}).waitFor();
  await modal.getByRole('button',{name:'提交交付',exact:true}).click();const complete=page.getByRole('dialog',{name:'提交交付',exact:true});await complete.getByRole('textbox',{name:'结果说明',exact:true}).fill('已核对进展，相关观察可回查');await complete.getByRole('checkbox').check();
  await page.screenshot({path:`tmp/verification/related-tasks-${type}-${width}-complete.png`});await complete.getByRole('button',{name:'提交结果并结束任务',exact:true}).click();await complete.waitFor({state:'detached'});await modal.locator('.task-scene.stage-closed').waitFor();
  await modal.getByRole('button',{name:'观察版本 1',exact:true}).first().click();await modal.waitFor({state:'detached'});await page.locator('#focused-content').getByText('虚构关联任务验收的观察内容',{exact:true}).waitFor();
  assert.equal(await page.getByRole('tab',{name:'全部动态',exact:true}).getAttribute('aria-selected'),'true');assert.equal(await composer.locator('textarea').inputValue(),'未提交的观察草稿');
  await page.locator('.related-tasks .task-list-row').first().waitFor();assert.equal(await page.locator('.related-tasks .task-list-row').count(),1);assert.equal((await get(a.id)).open_task_count,1);
  await page.locator('.related-tasks').getByRole('button',{name:'查看已关闭任务',exact:true}).click();await page.locator('.related-tasks').getByText('历史工作',{exact:true}).waitFor();assert.equal(await page.locator('.related-tasks .task-list-row').count(),2);
  await page.screenshot({path:`tmp/verification/related-tasks-${type}-${width}-closed.png`});
  assert.equal(new URL(page.url()).searchParams.has('from'),false,'archive task references must not change the return destination to the task book');
  await page.locator('.related-tasks .task-index-item').filter({hasText:'历史工作'}).click();await modal.getByRole('button',{name:'重新开启',exact:true}).click();const reopen=page.getByRole('dialog',{name:'重新开启任务',exact:true});await reopen.getByRole('button',{name:'重新开启',exact:true}).click();await reopen.waitFor({state:'detached'});await modal.getByRole('button',{name:'领取任务',exact:true}).waitFor();
  await modal.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.related-tasks .task-list-row').length===1);assert.equal((await get(a.id)).open_task_count,2);
  await page.locator('.related-tasks').getByRole('button',{name:'返回开启任务',exact:true}).click();await page.locator('.related-tasks .task-index-item').filter({hasText:'历史工作'}).click();await modal.getByRole('button',{name:'编辑任务',exact:true}).click();await edit.getByText('取消这项任务',{exact:true}).click();await edit.getByRole('textbox',{name:'取消原因',exact:true}).fill('虚构验收，明确取消');await edit.getByRole('button',{name:'确认取消任务',exact:true}).click();await edit.waitFor({state:'detached'});await modal.locator('.task-scene.stage-cancelled').waitFor();await modal.getByRole('button',{name:'关闭对话框',exact:true}).click();await page.locator('.related-tasks h3').filter({hasText:'1 项开启'}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  checks.push(`${type}/${status}/${width}px: multiple open tasks, separate closed history, shared detail, claim/edit/complete, cancel/reopen count refresh, observation-version navigation, draft/material preservation, no overflow`);
 }
 for(const width of [1440,390]){
  const a=await v.call('create_archive',{type:'person',status:'个人接触',name:'快捷操作预览 '+width,request_id:randomUUID()});created.push(a.id);
  await page.setViewportSize({width,height:width===390?844:1000});await page.goto(v.base+'/?archive='+a.id);
  for(const [label,status,count] of [['提交人事审核','人事审核',1],['确认加入待对接','已加入待对接',2],['确认已入伙','已入伙',2]]){
   await page.locator('.archive-primary-action').getByRole('button',{name:label,exact:true}).click();const confirm=page.getByRole('dialog',{name:label,exact:true});
   assert.ok(await confirm.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:`tmp/verification/archive-shortcut-${width}-${count}-${status}.png`});
   await confirm.getByRole('button',{name:label,exact:true}).click();await confirm.waitFor({state:'detached'});await page.waitForFunction(expected=>document.querySelector('.entity-heading .state-badge')?.textContent===expected,status==='已入伙'?'可接工作':status);
   assert.equal((await get(a.id)).status,status);assert.equal((await v.call('list_work_tasks',{archive_id:a.id,state:'open'})).tasks.length,count);
  }
  assert.equal(new URL(page.url()).pathname,'/members');assert.equal(await page.locator('.archive-primary-action').count(),0);
  checks.push(`${width}px: status shortcut uses shared state command, creates audit/onboarding, does not complete open tasks, and moves same-ID archive into members`);
 }
 assert.deepEqual(errors,[]);checks.push('No browser runtime errors');console.log('PASS: related tasks in external people, members and organizations through real HTTP/MCP');
}finally{
 try{if(browser)await browser.close();for(const id of created){let a=await get(id);if(!a.closed)await v.call('set_archive_state',{id,expected_version:a.version,status:'已弃用',...(a.person_role==='member'?{membership_action:'leave'}:{}),member_ids:[],request_id:randomUUID()});a=await get(id);await v.call('delete_archive',{id,expected_version:a.version,request_id:randomUUID()});}}
 finally{await v.close(checks);}
}
