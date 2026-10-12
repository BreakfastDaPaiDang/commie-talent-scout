import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('task-reopen'),checks=[],tasks=[];let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext();const [name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(v.base+'/tasks');await page.locator('.task-progress-total strong').waitFor();const initial=Number(await page.locator('.task-progress-total strong').textContent());
  const title='虚构重新开启验收 '+randomUUID().slice(0,8),task=await v.call('create_work_task',{kind:'custom',title,purpose:'验收已完成任务重开入口',delivery:'核对历史保留',deadline_at:new Date(Date.now()+86400000).toISOString(),request_id:randomUUID()});tasks.push(task);
  const claimed=await v.call('claim_work_task',{id:task.id,expected_version:task.version,request_id:randomUUID()});await v.call('complete_work_task',{id:task.id,expected_version:claimed.version,result_kind:'completed',result_text:'第一轮验收结果',request_id:randomUUID()});
  await page.reload();await page.locator('.task-progress-total strong').waitFor();assert.equal(Number(await page.locator('.task-progress-total strong').textContent()),initial+1);
  await page.getByRole('button',{name:'看板大厅',exact:true}).click();await page.locator('.task-board-column.stage-closed .task-board-card').filter({hasText:title}).getByRole('button').first().click();
  await page.getByRole('button',{name:'重新开启',exact:true}).click();const dialog=page.getByRole('dialog').last();await dialog.getByText('新的任务期限',{exact:true}).waitFor();assert.ok(await dialog.getByText('由你继续负责。原交付结果和讨论保留在历史中。',{exact:true}).isVisible());
  await dialog.getByLabel('7 天',{exact:true}).check();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`tmp/verification/task-reopen-${width}.png`,fullPage:true});await dialog.getByRole('button',{name:'重新开启',exact:true}).click();await page.getByRole('button',{name:'提交交付',exact:true}).waitFor();
  let detail=await v.call('get_work_task',{id:task.id});assert.equal(detail.task.status,'open');assert.equal(detail.task.owner_id,v.actor.id);assert.equal(detail.task.completed_at,null);assert.equal(detail.task.result_text,null);assert.ok(Date.parse(detail.task.deadline_at)>Date.now()+6*86400000);assert.equal(JSON.parse(detail.events.find(e=>e.kind==='task.reopened').before_json).result_text,'第一轮验收结果');
  await page.getByRole('button',{name:'关闭对话框',exact:true}).click();assert.equal(await page.locator('.task-board-column.stage-active .task-board-card').filter({hasText:title}).count(),1);assert.equal(await page.locator('.task-board-column.stage-closed .task-board-card').filter({hasText:title}).count(),0);
  await page.getByRole('button',{name:'任务簿',exact:true}).click();assert.equal(Number(await page.locator('.task-progress-total strong').textContent()),initial);
  await v.call('complete_work_task',{id:task.id,expected_version:detail.task.version,result_kind:'completed',result_text:'第二轮验收结果',request_id:randomUUID()});await page.reload();await page.locator('.task-progress-total strong').waitFor();assert.equal(Number(await page.locator('.task-progress-total strong').textContent()),initial+1);
  detail=await v.call('get_work_task',{id:task.id});assert.equal(detail.events.filter(e=>e.kind==='task.completed').length,2);
  checks.push(width+'px completed → reopen dialog → active hall, owner/deadline/history preserved, completion total corrected without double count');
 }
 assert.deepEqual(errors,[]);checks.push('no browser runtime errors');
}finally{if(browser)await browser.close();try{for(const task of tasks){let current=(await v.call('get_work_task',{id:task.id})).task;if(current.status==='completed')current=await v.call('reopen_work_task',{id:task.id,expected_version:current.version,owner_mode:'keep',deadline_at:new Date(Date.now()+86400000).toISOString(),request_id:randomUUID()});if(current.status==='open')await v.call('cancel_work_task',{id:task.id,expected_version:current.version,reason:'结束虚构重新开启验收',request_id:randomUUID()});}}finally{await v.close(checks);}}
