import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
assert.ok(!process.argv.includes('--remote'),'This fixture changes only the local demo avatar');
const v=await verificationClient('task-initiator-avatar'),checks=[],original=v.actor.avatar_id;let changed=false,task,browser;
try{
 const bytes=readFileSync('tests/fixtures/images/shapes.png'),ticket=await v.call('prepare_image_upload',{purpose:'member_avatar',member_id:v.actor.id,mime_type:'image/png',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 assert.equal((await fetch(ticket.url,{method:'PUT',headers:ticket.headers,body:bytes})).status,200);
 const member=(await v.call('get_member',{id:v.actor.id})).member;await v.call('set_avatar',{subject_type:'member',id:member.id,expected_version:member.version,attachment_id:ticket.attachment_id,request_id:randomUUID()});changed=true;
 task=await v.call('create_work_task',{kind:'custom',title:'虚构发起人头像验收 '+randomUUID().slice(0,6),purpose:'验证两个任务页面读取真实头像',delivery:'查看头像请求与实际图片',deadline_at:new Date(Date.now()+86400000).toISOString(),request_id:randomUUID()});
 const listed=(await v.http('/work-tasks?scope=all&state=all&limit=100')).body.tasks.find(t=>t.id===task.id);assert.ok(listed.initiator_version);checks.push('real HTTP list preserves initiator avatar version');
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),[name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));mkdirSync('tmp/verification/task-initiator-avatar',{recursive:true});
 async function checkImage(scope){const img=scope.locator('img').last();await img.scrollIntoViewIfNeeded();await img.waitFor();await img.evaluate(e=>e.decode());assert.ok(await img.evaluate(e=>e.naturalWidth>0));assert.equal(await img.getAttribute('src'),`/avatars/members/${v.actor.id}?v=${listed.initiator_version}`);}
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});await page.goto((process.env.CTS_UI_BASE??'http://127.0.0.1:5190')+'/tasks?task='+task.id);await page.locator('.task-scene-meta-grid').waitFor();await checkImage(page.locator('.task-scene-meta-grid > div').filter({hasText:'发起人'}));await page.screenshot({path:`tmp/verification/task-initiator-avatar/book-${width}.png`});
  await page.getByRole('button',{name:'看板大厅',exact:true}).click();const card=page.locator('.task-board-card').filter({hasText:task.title});await checkImage(card.locator('.task-board-card-meta > span').filter({hasText:'发起'}));await card.locator('.task-board-card-main').click();await checkImage(page.locator('dialog .task-scene-meta-grid > div').filter({hasText:'发起人'}));await page.screenshot({path:`tmp/verification/task-initiator-avatar/hall-${width}.png`});await page.keyboard.press('Escape');checks.push(`${width}: book, hall card and hall detail load actual uploaded avatar`);
 }
 assert.deepEqual(errors,[]);
}finally{
 await browser?.close();if(task){const current=(await v.call('get_work_task',{id:task.id})).task;await v.call('cancel_work_task',{id:task.id,expected_version:current.version,reason:'虚构头像验收结束',request_id:randomUUID()});}
 if(changed){const member=(await v.call('get_member',{id:v.actor.id})).member;await v.call('set_avatar',{subject_type:'member',id:member.id,expected_version:member.version,attachment_id:original,request_id:randomUUID()});}await v.close(checks);
}
