import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
import {wrangler} from './lib/cloudflare-admin.mjs';

assert.ok(!process.argv.includes('--production'),'Synthetic aging is restricted to staging');
const v=await verificationClient('archive-follow-ups'),checks=[],created=[];let browser;
try{
 for(const [type,status] of [['person','个人接触'],['org','视奸观察']]){
  const a=await v.call('create_archive',{type,status,name:'虚构超期跟进 '+randomUUID().slice(0,8),request_id:randomUUID()});created.push({...a,type});
 }
 mkdirSync('tmp/verification',{recursive:true});const at=new Date(Date.now()-31*86400000).toISOString(),file='tmp/verification/follow-up-fixtures.sql';
 writeFileSync(file,created.map(a=>`UPDATE archives SET updated_at='${at}' WHERE id='${a.id}';`).join('\n'));
 await wrangler(['d1','execute','cts-staging','--env','staging',v.target==='cloud'?'--remote':'--local','--file',file]);
 const input={archive_ids:created.map(a=>a.id),request_id:randomUUID()},first=await v.http('/work-tasks/archive-follow-up/generate',input);assert.equal(first.status,200);assert.equal(first.body.created_count,2);
 const replay=await v.call('generate_archive_follow_up_tasks',input);assert.equal(replay.replayed,true);assert.deepEqual(replay.tasks,first.body.tasks);
 assert.equal((await v.call('generate_archive_follow_up_tasks',{...input,request_id:randomUUID()})).created_count,0);
 for(const a of created){const row=(await v.call('get_archive',{id:a.id})).archive;assert.equal(row.updated_at,at);assert.equal(row.update_reminder.overdue,true);}
 checks.push('Real HTTP and MCP share generation, stable receipt, cycle deduplication and leave reminder unchanged');
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});const context=await browser.newContext({timezoneId:'Asia/Shanghai'}),[name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const a of created){
  const width=a.type==='person'?1440:390;await page.setViewportSize({width,height:900});await page.goto(v.base+(a.type==='person'?'/':'/organizations')+'?archive='+a.id);
  await page.locator('.related-tasks').getByRole('button',{name:/接触跟进或关闭档案/}).click();const modal=page.getByRole('dialog',{name:'任务详情',exact:true});await modal.waitFor();
  await modal.getByRole('button',{name:'领取任务',exact:true}).click();await modal.getByRole('button',{name:'提交交付',exact:true}).waitFor();
  assert.ok((await modal.textContent()).includes('早纪（人事版）'));assert.ok((await modal.textContent()).includes('接触跟进'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`tmp/verification/archive-follow-up-${width}.png`});
  const task=(await v.call('list_work_tasks',{archive_id:a.id})).tasks.find(t=>t.automation_rule==='archive.follow_up');assert.equal(task.owner_id,v.actor.id);
  const obs=await v.call('create_observation',{archive_id:a.id,body:'虚构验收：已联系并确认最新情况，后续持续跟进。',request_id:randomUUID()});
  assert.equal((await v.call('get_work_task',{id:task.id})).task.status,'open','archive update must not auto-complete the task');
  await v.call('complete_work_task',{id:task.id,expected_version:task.version,result_kind:'completed',result_text:'已在档案记录实际接触结果',references:[{observation_id:obs.id,content_version:1}],request_id:randomUUID()});
  assert.equal((await v.call('generate_archive_follow_up_tasks',{archive_ids:[a.id],request_id:randomUUID()})).created_count,0);
  checks.push(`${width}px ${a.type}: shared task detail, system initiator, claim, observation and explicit delivery work`);
 }
 assert.deepEqual(errors,[]);
}finally{
 if(browser)await browser.close();
 try{for(const a of created){let row=(await v.call('get_archive',{id:a.id})).archive;if(!row.closed)await v.call('set_archive_state',{id:a.id,expected_version:row.version,status:'已弃用',member_ids:[],request_id:randomUUID()});row=(await v.call('get_archive',{id:a.id})).archive;await v.call('delete_archive',{id:a.id,expected_version:row.version,request_id:randomUUID()});}}
 finally{await v.close(checks);}
}
