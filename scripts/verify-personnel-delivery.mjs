import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

const v=await verificationClient('personnel-delivery'),checks=[],created=[];let browser;
const future=()=>new Date(Date.now()+7*86400000).toISOString();
async function prepare(){
 const archive=await v.call('create_archive',{type:'person',name:'虚构人事联动 '+randomUUID().slice(0,8),request_id:randomUUID()});created.push(archive.id);
 const observation=await v.call('create_observation',{archive_id:archive.id,body:'虚构验收：已核对参与意愿及背景，审核通过；随后已完成组织介绍与联系安排。',request_id:randomUUID()});
 const current=(await v.call('get_archive',{id:archive.id})).archive;
 const referral=await v.call('refer_archive',{archive_id:archive.id,expected_version:current.version,deadline_at:future(),request_id:randomUUID()});
 const claimed=await v.call('claim_work_task',{id:referral.task_id,expected_version:1,request_id:randomUUID()});
 return {id:archive.id,task_id:referral.task_id,version:claimed.version,references:[{observation_id:observation.id,content_version:1}]};
}
try{
 mkdirSync('tmp/verification',{recursive:true});
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext({timezoneId:'Asia/Shanghai'}),[name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function completeInUi(id,result,width){
  await page.goto(v.base+'/tasks?task='+id);await page.getByRole('button',{name:'提交交付',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'提交交付',exact:true}),select=dialog.getByRole('combobox',{name:'完成结果',exact:true});
  assert.equal(await select.inputValue(),'');await select.selectOption(result);
  await dialog.getByText(result==='audit_passed'?'提交后将进入审核通过（待对接），自动创建待领取的入社对接任务，默认期限 7 天。':'提交后将转入社员档案，保留原有资料与历史。',{exact:true}).waitFor();
  await dialog.getByRole('textbox',{name:'结果说明',exact:true}).fill(result==='audit_passed'?'虚构审核通过，进入对接。':'虚构对接完成，转为社员。');
  await dialog.getByRole('checkbox').first().check();assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`tmp/verification/personnel-delivery-${width}-${result}.png`,fullPage:true});
  const submit=dialog.getByRole('button',{name:'提交结果并结束任务',exact:true});await submit.scrollIntoViewIfNeeded();
  await page.screenshot({path:`tmp/verification/personnel-delivery-${width}-${result}-submit.png`,fullPage:true});
  await submit.click();await dialog.waitFor({state:'detached'});
  const saved=(await v.call('get_work_task',{id})).task;assert.equal(saved.status,'completed');assert.equal(saved.result_kind,result);assert.equal(saved.result_references.length,1);
 }
 for(const width of [1440,390]){
  const s=await prepare();await page.setViewportSize({width,height:1000});await completeInUi(s.task_id,'audit_passed',width);
  let archive=(await v.call('get_archive',{id:s.id})).archive;assert.equal(archive.status,'已加入待对接');assert.equal(archive.person_role,'external');
  const tasks=await v.call('list_work_tasks',{archive_id:s.id}),next=tasks.tasks.filter(t=>t.kind==='onboarding');assert.equal(next.length,1);assert.equal(next[0].owner_id,null);
  await v.call('claim_work_task',{id:next[0].id,expected_version:next[0].version,request_id:randomUUID()});await completeInUi(next[0].id,'onboarding_completed',width);
  archive=(await v.call('get_archive',{id:s.id})).archive;assert.equal(archive.person_role,'member');assert.equal(archive.member_status,'可接工作');assert.equal(archive.closed,false);
  const members=await v.http('/archives?type=person&person_scope=members&query='+encodeURIComponent(archive.name));assert.equal(members.status,200);assert.ok(members.body.archives.some(a=>a.id===s.id));
  checks.push(`${width}px complete delivery dialogs: explicit approval, effect, observation reference, audit→onboarding→same member archive; HTTP/MCP readback`);
 }
 const s=await prepare(),input={id:s.task_id,expected_version:s.version,result_kind:'audit_passed',result_text:'MCP 明确审核通过',references:s.references,request_id:randomUUID()};
 const result=await v.call('complete_work_task',input),again=await v.call('complete_work_task',input);assert.equal(result.archive_advanced,true);assert.equal(again.replayed,true);assert.equal(again.next_task_id,result.next_task_id);
 const next=await v.call('claim_work_task',{id:result.next_task_id,expected_version:1,request_id:randomUUID()});
 const finish=await v.http('/work-tasks/complete',{...input,id:result.next_task_id,expected_version:next.version,result_kind:'onboarding_completed',request_id:randomUUID()});assert.equal(finish.status,200);assert.equal(finish.body.archive_status,'已入伙');
 checks.push('real MCP approval and idempotent receipt, HTTP onboarding completion share the same atomic workflow');
 const negative=await prepare();await v.call('complete_work_task',{id:negative.task_id,expected_version:negative.version,result_kind:'unable_to_contact',result_text:'暂未联系到，保留阶段',references:negative.references,request_id:randomUUID()});
 assert.equal((await v.call('get_archive',{id:negative.id})).archive.status,'人事审核');
 checks.push('unable-to-contact conclusion ends only the task, without inferred approval');assert.deepEqual(errors,[]);checks.push('no browser runtime errors');
}finally{
 if(browser)await browser.close();
 try{for(const id of created){const current=(await v.call('get_archive',{id})).archive;await v.call('delete_archive',{id,expected_version:current.version,request_id:randomUUID()});}}
 finally{await v.close(checks);}
}
