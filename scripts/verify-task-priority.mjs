import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('task-priority'),checks=[],tasks=[];let browser;
try{
 const prefix='虚构优先级核对 '+randomUUID().slice(0,8);
 for(const priority of ['P1','P0','P2'])tasks.push(await v.call('create_work_task',{kind:'custom',title:prefix+' '+priority,priority,purpose:'验证优先级排序',delivery:'仅用于虚构验收',deadline_at:new Date(Date.now()+86400000).toISOString(),request_id:randomUUID()}));
 const list=await v.call('list_work_tasks',{query:prefix});assert.deepEqual(list.tasks.map(t=>t.priority),['P0','P1','P2']);checks.push('HTTP-backed MCP list orders priority before creation time');
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext();const [name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:950});await page.goto(v.base+'/tasks');await page.getByRole('textbox',{name:'搜索任务',exact:true}).fill(prefix);await page.waitForFunction(()=>document.querySelectorAll('.task-row-title strong').length===3);
  assert.deepEqual(await page.locator('.task-row-title strong').allTextContents(),['P0','P1','P2'].map(p=>prefix+' '+p));await page.getByRole('button',{name:'看板大厅',exact:true}).click();
  assert.deepEqual(await page.locator('.task-board-card h3').allTextContents(),['P0','P1','P2'].map(p=>prefix+' '+p));await page.locator('.filter-toggle').click();await page.getByLabel('任务排序',{exact:true}).selectOption('updated');assert.equal((await page.locator('.task-board-card h3').allTextContents())[0],prefix+' P2');await page.getByRole('button',{name:'重置筛选',exact:true}).click();assert.equal((await page.locator('.task-board-card h3').allTextContents())[0],prefix+' P0');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`tmp/verification/task-priority-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByText('调整交付和期限',{exact:true}).click();await page.getByRole('dialog').getByLabel('接取期限',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`tmp/verification/task-publish-${width}.png`,fullPage:true});await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
  checks.push(width+'px: task book/hall default, manual sort, reset, expanded publishing form');
 }
}finally{if(browser)await browser.close();try{for(const task of tasks){const current=(await v.call('get_work_task',{id:task.id})).task;if(current.status==='open')await v.call('cancel_work_task',{id:task.id,expected_version:current.version,reason:'结束虚构排序验收',request_id:randomUUID()});}}finally{await v.close(checks);}}
