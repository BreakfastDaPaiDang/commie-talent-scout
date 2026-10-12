import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('task-book'),checks=[],tasks=[];let browser;
try{
 const prefix='虚构任务簿核对 '+randomUUID().slice(0,8);
 for(const priority of ['P1','P0','P2'])tasks.push(await v.call('create_work_task',{kind:'custom',labels:['cooperation'],title:prefix+' 等待 '+priority,priority,purpose:'验证任务簿状态优先及看板优先级',delivery:'仅用于虚构验收',deadline_at:new Date(Date.now()+86400000).toISOString(),request_id:randomUUID()}));
 const active=await v.call('create_work_task',{kind:'custom',labels:['monthly',prefix],title:prefix+' 进行 P2',priority:'P2',purpose:'验证多个标签与处理状态',delivery:'仅用于虚构验收',deadline_at:new Date(Date.now()+86400000).toISOString(),request_id:randomUUID()});tasks.push(active);
 await v.call('claim_work_task',{id:active.id,expected_version:active.version,request_id:randomUUID()});
 const completed=[];let offset=0;do{const result=await v.call('list_work_tasks',{scope:'mine',state:'closed',limit:100,offset});completed.push(...result.tasks.filter(t=>t.status==='completed'&&t.completed_at&&Date.parse(t.completed_at)<=Date.now()));offset=result.next_offset;}while(offset!==null);
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext();const [name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(v.base+'/tasks');await page.locator('.task-completion-record').waitFor();assert.equal(Number(await page.locator('.task-progress-total strong').textContent()),completed.length);
  await page.getByRole('textbox',{name:'搜索任务',exact:true}).fill(prefix);await page.waitForFunction(()=>document.querySelectorAll('.task-row-title strong').length===4);
  const titles=()=>page.locator('.task-row-title strong').allTextContents();assert.deepEqual(await titles(),[prefix+' 进行 P2',...['P0','P1','P2'].map(p=>prefix+' 等待 '+p)]);
  assert.equal(Number(await page.locator('.task-progress-total strong').textContent()),completed.length);
  await page.locator('.task-book-controls button').first().click();await page.getByLabel('任务标签筛选',{exact:true}).selectOption('monthly');assert.deepEqual(await titles(),[prefix+' 进行 P2']);await page.getByLabel('任务状态',{exact:true}).selectOption('waiting');assert.equal((await titles()).length,0);
  await page.getByLabel('任务状态',{exact:true}).selectOption('active');await page.getByLabel('任务标签筛选',{exact:true}).selectOption(prefix);assert.deepEqual(await titles(),[prefix+' 进行 P2']);
  await page.getByRole('button',{name:'清除',exact:true}).click();assert.equal((await titles()).length,4);assert.equal(Number(await page.locator('.task-progress-total strong').textContent()),completed.length);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`tmp/verification/task-book-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'看板大厅',exact:true}).click();assert.deepEqual(await page.locator('.task-board-column.stage-waiting h3').allTextContents(),['P0','P1','P2'].map(p=>prefix+' 等待 '+p));
  await page.locator('.filter-toggle').click();await page.getByLabel('任务排序',{exact:true}).selectOption('updated');assert.equal((await page.locator('.task-board-column.stage-waiting h3').allTextContents())[0],prefix+' 等待 P2');await page.getByRole('button',{name:'重置筛选',exact:true}).click();assert.equal((await page.locator('.task-board-column.stage-waiting h3').allTextContents())[0],prefix+' 等待 P0');
  await page.getByRole('button',{name:'新建',exact:true}).click();await page.getByText('调整交付和期限',{exact:true}).click();await page.getByRole('dialog').getByLabel('接取期限',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`tmp/verification/task-book-publish-${width}.png`,fullPage:true});await page.getByRole('button',{name:'关闭对话框',exact:true}).click();
  checks.push(width+'px: state-first book, multi-label/status filters, stable personal totals, priority-first hall, manual sort/reset and expanded publishing');
 }
 assert.deepEqual(errors,[]);checks.push('no browser runtime errors');
}finally{if(browser)await browser.close();try{for(const task of tasks){const current=(await v.call('get_work_task',{id:task.id})).task;if(current.status==='open')await v.call('cancel_work_task',{id:task.id,expected_version:current.version,reason:'结束虚构任务簿验收',request_id:randomUUID()});}}finally{await v.close(checks);}}
