import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {randomUUID as id} from 'node:crypto';
import {Archives} from '../app/server/archives.ts';
import {Observations} from '../app/server/observations.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';

export async function verifyFeishuInvitation({page,f,base}){
 const out='tmp/verification/feishu-invitation';mkdirSync(out,{recursive:true});
 const archives=new Archives(f.env,f.actor,'web'),observations=new Observations(f.env,f.actor,'web'),tasks=new WorkTasks(f.env,f.actor,'web');
 const at='2026-12-20T15:59:59.000Z';await page.clock.install({time:new Date(at)});
 for(const width of [1440,390]){
  await page.clock.setFixedTime(new Date(at));await page.setViewportSize({width,height:width===390?844:1080});
  const archive=await archives.create({type:'person',name:`飞书接入验收 ${width}`,request_id:id()});
  const refer=await tasks.refer({archive_id:archive.id,expected_version:archive.version,deadline_at:'2099-01-01T00:00:00.000Z',request_id:id()});
  const audit=await tasks.claim({id:refer.task_id,expected_version:1,request_id:id()}),auditObs=await observations.create({archive_id:archive.id,body:'确认审核通过',request_id:id()});
  const approved=await tasks.complete({id:audit.id,expected_version:audit.version,result_kind:'audit_passed',result_text:'审核完成',references:[{observation_id:auditObs.id,content_version:1}],request_id:id()});assert.notEqual(approved.membership_joined,true);
  await tasks.claim({id:approved.next_task_id,expected_version:1,request_id:id()});await observations.create({archive_id:archive.id,body:'本轮对接已完成，可以正式入社。',request_id:id()});
  await page.goto(base+'/tasks?task='+approved.next_task_id);await page.getByRole('button',{name:'提交交付',exact:true}).click();const form=page.getByRole('dialog',{name:'提交交付',exact:true});
  await form.getByLabel('完成结果',{exact:true}).selectOption('onboarding_completed');await form.getByLabel('结果说明',{exact:true}).fill('对接完成，邀请加入飞书。');await form.locator('.task-result-references input[type=checkbox]').first().check();
  // A known failed command must leave the completion form open and never show success.
  await page.route('**/api/work-tasks/complete',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY',message:'验收暂时失败'}})}));
  await form.getByRole('button',{name:'提交结果并结束任务',exact:true}).click();await form.getByText('验收暂时失败',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog',{name:'加入飞书',exact:true}).count(),0);await page.unroute('**/api/work-tasks/complete');
  // Lost HTTP response uses the committed receipt and still opens the invitation.
  await page.route('**/api/work-tasks/complete',async r=>{await r.fetch();await r.abort('failed');});
  await form.getByRole('button',{name:'提交结果并结束任务',exact:true}).click();const dialog=page.getByRole('dialog',{name:'加入飞书',exact:true});await dialog.waitFor();await page.unroute('**/api/work-tasks/complete');
  assert.equal((await archives.get(archive.id)).person_role,'member');await dialog.getByText('入职成功，请引入飞书',{exact:true}).waitFor();
  const imageInfo=await dialog.locator('svg image').evaluate(async el=>{const image=new Image();image.src=el.getAttribute('href');await image.decode();return [image.naturalWidth,image.naturalHeight];});assert.deepEqual(imageInfo,[1080,1920]);
  await dialog.screenshot({path:`${out}/valid-${width}.png`});await dialog.locator('.feishu-qr').screenshot({path:`${out}/qr-${width}.png`});assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await page.clock.setFixedTime(new Date('2026-12-21T00:00:00+08:00'));await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await dialog.getByText('已经过期，找神棍和散言更新',{exact:true}).waitFor();assert.equal(await dialog.locator('image').count(),0);await dialog.screenshot({path:`${out}/expired-${width}.png`});
  await dialog.getByRole('button',{name:'知道了',exact:true}).click();await page.reload();await page.getByRole('button',{name:'分享任务',exact:true}).waitFor();assert.equal(await page.getByRole('dialog',{name:'加入飞书',exact:true}).count(),0);
 }
 await page.clock.setFixedTime(new Date(at));await page.goto('http://127.0.0.1:5196/?feishu-invitation');await page.getByText('入职成功，请引入飞书',{exact:true}).waitFor();await page.getByRole('dialog',{name:'加入飞书',exact:true}).screenshot({path:out+'/shared-preview.png'});
 console.log('feishu-invitation: real membership delivery, failed write, lost response, desktop/mobile, expiry, refresh and shared preview passed');
}
