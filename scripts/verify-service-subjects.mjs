import assert from 'node:assert/strict';
import {randomUUID as uuid,createHash} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
assert.ok(!process.argv.includes('--remote'),'Only changes isolated local fixtures');
const v=await verificationClient('service-subjects'),checks=[];const serviceId='00000000-0000-4000-8000-000000000083';let browser,archiveId,taskId,originalAvatar,changedAvatar=false;
try{
 const service=(await v.call('get_member',{id:serviceId})).member;originalAvatar=service.avatar_id;assert.equal(service.identity_kind,'service');
 const original=readFileSync('public/art/zaoji-hr.png'),avatarResponse=await fetch(v.base+'/avatars/members/'+serviceId,{headers:{Cookie:v.sessionCookie}});
 if(!originalAvatar)assert.deepEqual(Buffer.from(await avatarResponse.arrayBuffer()),original);
 checks.push('real account API exposes service identity; default avatar bytes equal the supplied original');
 const fixtureName='虚构早纪跟进验收 '+uuid().slice(0,6),subject=await v.call('create_archive',{type:'person',name:fixtureName,request_id:uuid()});archiveId=subject.id;
 // Age only this verification fixture via local D1, not production or another archive.
 const {execFileSync}=await import('node:child_process');
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','cts-staging','--local','--env','staging','--command',`UPDATE archives SET updated_at='2020-01-01T00:00:00.000Z' WHERE id='${archiveId}'`],{stdio:'pipe'});
 const generated=await v.http('/work-tasks/archive-follow-up/generate',{archive_ids:[archiveId],request_id:uuid()});assert.equal(generated.status,200);taskId=generated.body.tasks[0].id;
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),[name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));mkdirSync('tmp/verification/service-subjects',{recursive:true});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(v.base+'/tasks?task='+taskId,{waitUntil:'domcontentloaded'});
  const initiator=page.locator('.task-scene-meta-grid > div').filter({hasText:'发起人'}).locator('.task-owner-value');await initiator.waitFor();await initiator.locator('img').evaluate(e=>e.decode());
  await initiator.scrollIntoViewIfNeeded();await page.screenshot({path:`tmp/verification/service-subjects/book-${width}.png`});
  await page.getByRole('button',{name:'看板大厅',exact:true}).click();const card=page.locator('.task-board-card').filter({hasText:fixtureName});await card.locator('.task-board-card-main').click();
  await page.locator('dialog .task-scene-meta-grid .task-owner-value img').evaluate(e=>e.decode());await page.screenshot({path:`tmp/verification/service-subjects/hall-${width}.png`});
  await page.goto(v.base+'/admin/members',{waitUntil:'domcontentloaded'});const row=page.getByRole('row').filter({hasText:'saki-hr'});await row.waitFor();assert.ok((await row.innerText()).includes('服务账号'));await row.locator('img').evaluate(e=>e.decode());
  assert.ok((await page.getByRole('row').filter({has:page.getByRole('button')}).first().innerText()).includes('saki-hr'),'Zaoji is first before pagination');
  await page.screenshot({path:`tmp/verification/service-subjects/accounts-${width}.png`});
  await row.getByRole('button',{name:'管理 早纪（人事版）',exact:true}).click();const dialog=page.getByRole('dialog',{name:'管理猎头账号',exact:true});assert.equal(await dialog.getByRole('button',{name:'重置密码'}).count(),0);assert.equal(await dialog.getByRole('button',{name:'授予管理员'}).count(),0);
  await dialog.getByRole('button',{name:'修改早纪（人事版）的头像',exact:true}).click();await page.getByRole('dialog',{name:'修改头像',exact:true}).getByText('移除上传头像后恢复早纪的默认头像。').waitFor();await page.screenshot({path:`tmp/verification/service-subjects/editor-${width}.png`});await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  checks.push(`${width}: actual task book, hall modal, service account management and full avatar editor`);
 }
 const bytes=readFileSync('tests/fixtures/images/shapes.png'),ticket=await v.call('prepare_image_upload',{purpose:'member_avatar',member_id:serviceId,mime_type:'image/png',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 assert.equal((await fetch(ticket.url,{method:'PUT',headers:ticket.headers,body:bytes})).status,200);
 const current=(await v.call('get_member',{id:serviceId})).member;await v.call('set_avatar',{subject_type:'member',id:serviceId,expected_version:current.version,attachment_id:ticket.attachment_id,request_id:uuid()});changedAvatar=true;
 const detail=(await v.call('get_work_task',{id:taskId})).task;assert.equal(detail.initiator_version,current.version+1);
 const response=await fetch(v.base+'/avatars/members/'+detail.initiator_id,{headers:{Cookie:v.sessionCookie}});assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 checks.push('changing the account avatar also changes the service identity avatar and task version projection');assert.deepEqual(errors,[]);
}finally{
 await browser?.close();
 if(changedAvatar){const current=(await v.call('get_member',{id:serviceId})).member;await v.call('set_avatar',{subject_type:'member',id:current.id,expected_version:current.version,attachment_id:originalAvatar,request_id:uuid()});}
 if(taskId){const t=(await v.call('get_work_task',{id:taskId})).task;if(t.status==='open')await v.call('cancel_work_task',{id:t.id,expected_version:t.version,reason:'虚构验收结束',request_id:uuid()});}
 if(archiveId){const a=(await v.call('get_archive',{id:archiveId})).archive;await v.call('delete_archive',{id:a.id,expected_version:a.version,request_id:uuid()});}
 await v.close(checks);
}
