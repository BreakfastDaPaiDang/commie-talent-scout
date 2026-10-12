import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

const v=await verificationClient('rule-retirement'),checks=[];let browser,archiveId,taskId;
try{
 const tools=await v.client.listTools();
 assert.equal(tools.tools.some(t=>['preview_monthly_work_tasks','generate_monthly_work_tasks'].includes(t.name)),false);
 for(const action of ['preview','generate'])assert.equal((await v.http('/work-tasks/monthly/'+action,{month:'2099-01',request_id:uuid()})).status,404);
 checks.push('HTTP old generator returns JSON 404; MCP no longer advertises either monthly tool');
 const archive=await v.call('create_archive',{type:'person',name:'虚构规则收拢 '+uuid().slice(0,8),request_id:uuid()});archiveId=archive.id;
 const task=await v.call('create_work_task',{archive_id:archive.id,kind:'custom',title:'虚构留档与交付分离',purpose:'核对真实网页与MCP',delivery:'先留档再交付',deadline_at:'2099-01-01T00:00:00.000Z',request_id:uuid()});taskId=task.id;
 await v.call('claim_work_task',{id:task.id,expected_version:task.version,request_id:uuid()});
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'}),[name,...value]=v.sessionCookie.split('=');
 await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(v.base+'/tasks',{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'新建',exact:true}).click();let dialog=page.getByRole('dialog',{name:'发布任务',exact:true});
 await dialog.getByText('调整交付和期限',{exact:true}).click();
 await dialog.locator('.task-advanced textarea').waitFor();
 assert.equal(await dialog.locator('.monthly-task-tools').count(),0);
 mkdirSync('tmp/verification/rule-retirement',{recursive:true});
 await dialog.locator('.task-advanced input').scrollIntoViewIfNeeded();
 await page.screenshot({path:'tmp/verification/rule-retirement/create-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await dialog.evaluate(e=>e.getBoundingClientRect().width<=window.innerWidth));
 await dialog.locator('.task-advanced input').scrollIntoViewIfNeeded();
 await page.screenshot({path:'tmp/verification/rule-retirement/create-mobile-bottom.png',fullPage:true});
 await dialog.locator('.task-label-picker').first().scrollIntoViewIfNeeded();
 await page.screenshot({path:'tmp/verification/rule-retirement/create-mobile.png',fullPage:true});
 await dialog.getByRole('button',{name:'关闭对话框',exact:true}).click();
 checks.push('desktop and mobile full publish forms retain ordinary fields and remove the monthly generation panel');
 await page.setViewportSize({width:1440,height:1000});
 await page.goto(v.base+'/?archive='+archive.id+'&task='+task.id,{waitUntil:'domcontentloaded'});
 await page.getByRole('textbox',{name:'新的观察记录',exact:true}).fill('虚构记录：实际留档不会隐式完成任务。');
 await page.getByRole('button',{name:'发布记录',exact:true}).click();
 await page.locator('.record-body').filter({hasText:'虚构记录：实际留档不会隐式完成任务。'}).waitFor();
 assert.equal((await v.call('get_work_task',{id:task.id})).task.status,'open');
 const observations=await v.call('list_observations',{archive_id:archive.id});const observation=observations.observations[0];
 await page.locator('.record-actions').first().getByRole('button',{name:'编辑',exact:true}).click();
 await page.setViewportSize({width:390,height:844});dialog=page.getByRole('dialog');
 await dialog.getByRole('textbox',{name:'观察正文',exact:true}).fill('虚构记录：手机修改同样不隐式完成任务。');
 await page.screenshot({path:'tmp/verification/rule-retirement/edit-mobile.png',fullPage:true});
 await dialog.getByRole('button',{name:'保存新版本',exact:true}).click();await dialog.waitFor({state:'detached'});
 const current=(await v.call('get_work_task',{id:task.id})).task;assert.equal(current.status,'open');
 await v.call('complete_work_task',{id:task.id,expected_version:current.version,result_kind:'completed',result_text:'已确认留档并完成跟进',references:[{observation_id:observation.id,content_version:2}],request_id:uuid()});
 assert.equal((await v.call('get_work_task',{id:task.id})).task.status,'completed');assert.deepEqual(errors,[]);
 checks.push('task-linked archive URL can publish and edit observations; task stays open until explicit MCP delivery');
}finally{
 await browser?.close();
 try{
  if(taskId){const task=(await v.call('get_work_task',{id:taskId})).task;if(task.status==='open')await v.call('cancel_work_task',{id:task.id,expected_version:task.version,reason:'虚构验收结束',request_id:uuid()});}
  if(archiveId){const archive=(await v.call('get_archive',{id:archiveId})).archive;await v.call('delete_archive',{id:archive.id,expected_version:archive.version,request_id:uuid()});}
 }finally{await v.close(checks);}
}
