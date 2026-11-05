import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('task-inline-observation'),checks=[],archives=[];let browser;
try{
 mkdirSync('tmp/verification',{recursive:true});browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext({timezoneId:'Asia/Shanghai'}),[name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,390]){
  const archive=await v.call('create_archive',{type:'person',name:'虚构弹窗直接留档 '+width+' '+randomUUID().slice(0,6),request_id:randomUUID()});archives.push(archive.id);
  const task=await v.call('create_work_task',{archive_id:archive.id,kind:'audit',title:'弹窗内留档交付',purpose:'无需离开任务页',delivery:'保存并引用本次观察',deadline_at:new Date(Date.now()+86400000).toISOString(),request_id:randomUUID()});await v.call('claim_work_task',{id:task.id,expected_version:1,request_id:randomUUID()});
  let releaseList,staleReady;const staleCaptured=new Promise(resolve=>staleReady=resolve),hold=new Promise(resolve=>releaseList=resolve);
  await page.route('**/api/observations?*',async route=>{const response=await route.fetch();staleReady();await hold;await route.fulfill({response});});
  let writes=0;
  await page.route('**/api/observations/create',async route=>{writes++;const response=await route.fetch();if(writes===1)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SIMULATED_LOST_RESPONSE',message:'本次响应丢失，请重试核对'}})});else await route.fulfill({response});});
  await page.setViewportSize({width,height:1000});await page.goto(v.base+'/tasks?task='+task.id);await page.getByRole('button',{name:'提交交付',exact:true}).click();const dialog=page.getByRole('dialog',{name:'提交交付',exact:true});await staleCaptured;
  const summary='虚构本次沟通：已联系并了解近期进展，需要下周继续确认。';await dialog.getByRole('textbox',{name:'结果说明',exact:true}).fill(summary);
  await dialog.getByRole('button',{name:'记录本次观察',exact:true}).click();const editor=dialog.getByRole('textbox',{name:'本次观察',exact:true});assert.equal(await editor.inputValue(),summary);
  const body=summary+' 本次观察直接在交付弹窗保存。';await editor.fill(body);await dialog.getByRole('button',{name:'保存到档案并引用',exact:true}).click();await dialog.getByText('本次响应丢失，请重试核对',{exact:true}).waitFor();
  assert.equal(await editor.inputValue(),body);await dialog.getByRole('button',{name:'重试保存并引用',exact:true}).click();await dialog.getByText('已选 1 条',{exact:true}).waitFor();assert.equal(writes,1);
  releaseList();await page.waitForResponse(r=>r.url().includes('/api/observations?'));await dialog.getByRole('checkbox').first().waitFor();assert.equal(await dialog.getByRole('checkbox').first().isChecked(),true);assert.equal(await dialog.getByRole('textbox',{name:'结果说明',exact:true}).inputValue(),summary);
  assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`tmp/verification/task-inline-observation-${width}.png`,fullPage:true});
  await dialog.getByRole('button',{name:'提交结果并结束任务',exact:true}).click();await dialog.waitFor({state:'detached'});
  const completed=(await v.call('get_work_task',{id:task.id})).task;assert.equal(completed.status,'completed');assert.equal(completed.result_text,summary);assert.equal(completed.result_references.length,1);
  const observation=await v.call('get_observation',{id:completed.result_references[0].observation_id});assert.equal(observation.observation.body,body);assert.equal(observation.observation.archive_id,archive.id);
  const list=await v.call('list_observations',{archive_id:archive.id});assert.equal(list.observations.length,1);assert.ok(page.url().includes('/tasks?task='+task.id));checks.push(`${width}px inline publication, response-loss receipt recovery, stale-list preservation, automatic version reference and real delivery without navigation`);
  await page.unroute('**/api/observations?*');await page.unroute('**/api/observations/create');
 }
 assert.deepEqual(errors,[]);checks.push('no browser runtime errors');
}finally{if(browser)await browser.close();try{for(const id of archives){const a=(await v.call('get_archive',{id})).archive;await v.call('delete_archive',{id,expected_version:a.version,request_id:randomUUID()});}}finally{await v.close(checks);}}
