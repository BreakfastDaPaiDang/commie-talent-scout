import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
assert.ok(!process.argv.includes('--production'),'Synthetic member verification is restricted to staging');
const v=await verificationClient('member-monthly'),checks=[],created=[];let browser;
try{
 assert.equal(v.actor.username,'saki-hr');
 for(const status of ['已入伙','个人接触'])created.push(await v.call('create_archive',{type:'person',status,name:'虚构月度跟进 '+uuid().slice(0,8),request_id:uuid()}));
 const input={archive_ids:created.map(a=>a.id),request_id:uuid()},first=await v.http('/work-tasks/member-monthly/generate',input);assert.equal(first.status,200);assert.equal(first.body.created_count,1);assert.equal(first.body.tasks[0].archive_id,created[0].id);
 const replay=await v.call('generate_member_monthly_follow_up_tasks',input);assert.equal(replay.replayed,true);assert.deepEqual(replay.tasks,first.body.tasks);
 assert.equal((await v.call('generate_member_monthly_follow_up_tasks',{...input,request_id:uuid()})).created_count,0);
 let task=(await v.call('get_work_task',{id:first.body.tasks[0].id})).task;assert.equal(task.priority,'P2');assert.equal(task.owner_id,null);assert.equal(task.initiator_id,v.actor.id);
 checks.push('saki-hr retains verification identity; HTTP/MCP share formal-only generation, replay and deduplication');
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});const context=await browser.newContext({timezoneId:'Asia/Shanghai'}),[name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});await page.goto(v.base+'/members?archive='+created[0].id);
  await page.locator('.related-tasks').getByRole('button',{name:/月人事跟进/}).click();const modal=page.getByRole('dialog',{name:'任务详情',exact:true});await modal.waitFor();
  assert.ok((await modal.textContent()).includes('早纪（人事版）'));await modal.getByRole('button',{name:'领取任务',exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`tmp/verification/member-monthly-${width}.png`});
  if(width===390){await modal.getByRole('button',{name:'领取任务',exact:true}).click();await modal.getByRole('button',{name:'提交交付',exact:true}).waitFor();}
 }
 task=(await v.call('get_work_task',{id:task.id})).task;assert.equal(task.owner_id,v.actor.id);
 const obs=await v.call('create_observation',{archive_id:created[0].id,body:'虚构验收：记录本月实际联系情况。',request_id:uuid()});assert.equal((await v.call('get_work_task',{id:task.id})).task.status,'open');
 await v.call('complete_work_task',{id:task.id,expected_version:task.version,result_kind:'completed',result_text:'已记录联系情况',references:[{observation_id:obs.id,content_version:1}],request_id:uuid()});
 assert.equal((await v.call('generate_member_monthly_follow_up_tasks',{...input,request_id:uuid()})).created_count,0);assert.deepEqual(errors,[]);
 checks.push('Desktop/mobile existing related-task dialog, service avatar identity, claim, observation and explicit delivery; completion never regenerates current month');
}finally{
 if(browser)await browser.close();
 try{for(const a of created){const row=(await v.call('get_archive',{id:a.id})).archive;await v.call('delete_archive',{id:a.id,expected_version:row.version,request_id:uuid()});}}finally{await v.close(checks);}
}
