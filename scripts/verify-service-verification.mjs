import assert from 'node:assert/strict';
import {randomUUID as uuid,createHash} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('service-verification',{environment:process.argv.includes('--production')?'production':'staging'}),checks=[];
let archiveId,browser;
try{
 assert.equal(v.actor.identity_kind,'service');assert.equal(v.actor.execution_purpose,'verification');assert.equal(v.actor.role,'admin');
 assert.equal((await v.call('whoami')).member.id,v.actor.id);checks.push('browser and MCP use the same service identity and verification authority');
 const name='虚构服务凭据验收 '+uuid().slice(0,8),created=await v.call('create_archive',{type:'person',name,status:'个人接触',member_ids:[v.actor.id],request_id:uuid()});archiveId=created.id;
 const requestId=uuid(),observation=await v.call('create_observation',{archive_id:archiveId,body:'虚构验收：服务身份通过真实业务命令写入。',request_id:requestId});
 const receipt=await v.http('/commands/'+requestId);assert.equal(receipt.body.execution_purpose,'verification');
 const bytes=readFileSync('tests/fixtures/images/shapes.png'),ticket=await v.call('prepare_image_upload',{purpose:'archive_avatar',archive_id:archiveId,mime_type:'image/png',byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 assert.equal((await fetch(ticket.url,{method:'PUT',headers:ticket.headers,body:bytes})).status,200);
 const current=(await v.call('get_archive',{id:archiveId})).archive;await v.call('set_avatar',{subject_type:'archive',id:archiveId,expected_version:current.version,attachment_id:ticket.attachment_id,request_id:uuid()});
 checks.push('archive, observation, image upload and avatar attachment use real commands with verification receipts');
 const journal=await v.http('/admin/calls?tool=create_observation');assert.ok(journal.body.calls.some(c=>c.request_id===requestId&&c.execution_purpose==='verification'&&c.member_id===v.actor.id));checks.push('MCP review records execution purpose and service identity');
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext(),[cookieName,...cookieValue]=v.sessionCookie.split('=');await context.addCookies([{name:cookieName,value:cookieValue.join('='),url:v.base}]);const page=await context.newPage();
 const out='tmp/verification/service-verification-'+v.target;mkdirSync(out,{recursive:true});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto(v.base+'/admin/members');const first=page.getByRole('row').filter({has:page.getByRole('button')}).first();await first.waitFor();assert.ok((await first.innerText()).includes('zaoji-hr'));await first.locator('img').evaluate(e=>e.decode());await page.screenshot({path:out+`/accounts-${width}.png`});
 }
 const fetched=await v.call('get_observation',{id:observation.id});assert.equal(fetched.observation.author_id,v.actor.id);checks.push('desktop/mobile account UI opens with service session and original avatar');
}finally{
 if(browser)await browser.close();
 try{if(archiveId){let current=(await v.call('get_archive',{id:archiveId})).archive;assert.ok(current.name.startsWith('虚构服务凭据验收 '));if(!current.closed)await v.call('set_archive_state',{id:archiveId,expected_version:current.version,status:'已弃用',member_ids:[],request_id:uuid()});current=(await v.call('get_archive',{id:archiveId})).archive;await v.call('delete_archive',{id:archiveId,expected_version:current.version,request_id:uuid()});}}
 finally{await v.close(checks);}
}
