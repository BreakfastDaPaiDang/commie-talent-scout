import assert from 'node:assert/strict';
import {randomUUID as uuid,randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

const v=await verificationClient('archive-trash'),checks=[],created=[],out='tmp/verification/archive-trash-'+v.target;
mkdirSync(out,{recursive:true});let browser,page,member;
async function memberHttp(path,body,cookie){const r=await fetch(v.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:v.base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function chooseTrash(type,name){
 if((await page.viewportSize()).width<600){await page.getByRole('button',{name:'打开工具导航',exact:true}).click();await page.locator('.mobile-menu').getByRole('button',{name:'已删除档案',exact:true}).click();}
 else{await page.locator('.account-menu summary').click();await page.locator('.account-menu').getByRole('button',{name:'已删除档案',exact:true}).click();}
 if(type==='org')await page.locator('.scope-tabs').getByRole('button',{name:'组织',exact:true}).click();
 await page.getByRole('textbox',{name:'搜索档案',exact:true}).fill(name);await page.getByRole('button',{name:'查看'+name,exact:true}).click();await page.getByRole('button',{name:'恢复档案',exact:true}).waitFor();
}
try{
 const suffix=uuid().slice(0,8),password=randomBytes(24).toString('hex'),newPassword=randomBytes(24).toString('hex');
 member=await v.call('create_member',{username:'trash-'+suffix,name:'虚构档案删除作者 '+suffix,temporary_password:password,request_id:uuid()});
 const first=await memberHttp('/auth/login',{username:'trash-'+suffix,password});assert.equal(first.status,200);assert.equal((await memberHttp('/auth/password',{current_password:password,new_password:newPassword},first.cookie)).status,200);const login=await memberHttp('/auth/login',{username:'trash-'+suffix,password:newPassword});assert.equal(login.status,200);
 const name='虚构整档恢复 '+suffix,a=await v.call('create_archive',{type:'person',name,request_id:uuid()});created.push(a.id);
 const own=await memberHttp('/observations/create',{archive_id:a.id,body:'属于原作者的虚构内容 '+suffix,request_id:uuid()},login.cookie);assert.equal(own.status,200);
 await v.call('update_observation',{id:own.body.id,expected_version:1,body:'第二版虚构内容 '+suffix,occurred_at:null,request_id:uuid()});
 const png=readFileSync('tests/fixtures/images/shapes.png'),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',png)).toString('hex'),ticket=await v.call('prepare_image_upload',{purpose:'observation',archive_id:a.id,mime_type:'image/png',byte_size:png.length,sha256});
 assert.equal((await fetch(ticket.url,{method:'PUT',headers:ticket.headers,body:png})).status,200);
 const picture=await v.call('create_observation',{archive_id:a.id,body:'虚构保留图片 '+suffix,attachment_ids:[ticket.attachment_id],request_id:uuid()});
 const current=(await v.call('get_archive',{id:a.id})).archive;await v.call('set_archive_state',{id:a.id,expected_version:current.version,status:'已弃用',member_ids:[v.actor.id],request_id:uuid()});
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'}),[cookieName,...cookieValue]=v.sessionCookie.split('=');await context.addCookies([{name:cookieName,value:cookieValue.join('='),url:v.base}]);page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(v.base+'/?archive='+a.id);await page.getByRole('button',{name:'删除档案',exact:true}).click();let dialog=page.getByRole('dialog',{name:'删除档案',exact:true});assert.ok((await dialog.textContent()).includes(name));await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await v.call('get_archive',{id:a.id})).archive.deleted,false);
 await page.getByRole('button',{name:'删除档案',exact:true}).click();await page.screenshot({path:out+'/desktop-delete.png'});await page.getByRole('button',{name:'确认删除档案',exact:true}).click();await dialog.waitFor({state:'detached'});
 assert.equal((await v.call('list_archives',{type:'person',query:name})).archives.length,0);assert.equal((await v.call('list_archives',{type:'person',deleted:true,query:name})).archives[0].id,a.id);
 for(const path of ['/archives/'+a.id,'/observations/'+own.body.id,'/observations/'+own.body.id+'/versions','/archives/'+a.id+'/timeline'])assert.equal((await memberHttp(path,undefined,login.cookie)).status,404,path);
 assert.equal((await memberHttp('/archives?type=person&deleted=true',undefined,login.cookie)).status,403);
 assert.equal((await fetch(v.base+'/images/'+ticket.attachment_id,{headers:{Cookie:login.cookie}})).status,404);
 checks.push('desktop closed archive deletes without reopening; cancel is harmless; ordinary author and old image links lose access; normal HTTP and MCP lists exclude trash');
 await chooseTrash('person',name);assert.equal(await page.getByRole('button',{name:'编辑档案',exact:true}).count(),0);assert.equal(await page.getByRole('textbox',{name:'新的观察记录',exact:true}).count(),0);assert.equal(await page.locator('.record-actions button').count(),0);
 await page.waitForFunction(()=>{const img=document.querySelector('.timeline .image-gallery img');return img?.complete&&img.naturalWidth>0;});await page.screenshot({path:out+'/desktop-trash.png'});
 await page.getByRole('button',{name:'恢复档案',exact:true}).click();assert.ok((await page.getByRole('dialog').textContent()).includes('已弃用'));await page.getByRole('button',{name:'确认恢复档案',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
 const restored=(await v.call('get_archive',{id:a.id})).archive;assert.equal(restored.closed,true);assert.equal(restored.status,'已弃用');assert.ok(restored.members.some(m=>m.id===v.actor.id));assert.equal((await v.call('list_observation_versions',{id:own.body.id})).versions.length,2);assert.equal((await v.call('get_observation',{id:picture.id})).observation.attachments[0].id,ticket.attachment_id);assert.equal((await memberHttp('/observations/'+own.body.id,undefined,login.cookie)).status,200);
 checks.push('admin trash is read-only and decodes preserved images; restoration retains closed status, members, original author and immutable text/image versions');
 const orgName='虚构手机回收组织 '+suffix,org=await v.call('create_archive',{type:'org',name:orgName,request_id:uuid()});created.push(org.id);
 await page.setViewportSize({width:390,height:844});await page.goto(v.base+'/organizations?archive='+org.id);await page.getByRole('button',{name:'编辑档案',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'删除档案',exact:true}).click();
 await v.call('create_observation',{archive_id:org.id,body:'确认期间到达的新观察 '+suffix,request_id:uuid()});await page.getByRole('button',{name:'确认删除档案',exact:true}).click();await page.getByRole('button',{name:'重新读取档案状态',exact:true}).waitFor();assert.equal((await v.call('get_archive',{id:org.id})).archive.deleted,false);await page.screenshot({path:out+'/mobile-conflict.png'});
 await page.getByRole('button',{name:'重新读取档案状态',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor({state:'detached'});const confirm=await page.getByRole('button',{name:'确认删除档案',exact:true}).boundingBox();assert.ok(confirm.y>=0&&confirm.y+confirm.height<=844);await page.getByRole('button',{name:'确认删除档案',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
 await chooseTrash('org',orgName);assert.equal(await page.getByRole('button',{name:'重新开启',exact:true}).count(),0);await page.locator('.record-body').filter({hasText:'确认期间到达的新观察'}).waitFor();await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:out+'/mobile-trash.png'});await page.getByRole('button',{name:'恢复档案',exact:true}).click();
 let lost=true;await page.route('**/api/archives/restore',async route=>{if(lost){lost=false;await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'确认恢复档案',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();await page.getByRole('button',{name:'确认恢复档案',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});await page.unroute('**/api/archives/restore');
 const final=(await v.call('get_archive',{id:org.id})).archive;assert.equal(final.closed,false);assert.equal(final.deleted,false);assert.equal((await v.call('list_archive_events',{id:org.id})).events.filter(e=>e.kind==='archive.restored').length,1);
 checks.push('mobile editor, trash type switch, conflict reload and visible confirm actions work; lost restore response retries one request without duplicating restoration');
 async function findManaged(){for(let i=0;i<20;i++){if(await page.getByRole('button',{name:'管理 虚构档案删除作者 '+suffix,exact:true}).count())return;const more=page.getByRole('button',{name:'加载更多',exact:true});await more.waitFor();await more.click();await page.getByText('正在读取账号…',{exact:true}).waitFor({state:'detached'});}throw new Error('Fixture member not found in paginated management view');}
 await page.setViewportSize({width:1440,height:1000});await page.goto(v.base+'/admin/members');await page.getByText('正在读取账号…',{exact:true}).waitFor({state:'detached'});await findManaged();await page.getByRole('button',{name:'管理 虚构档案删除作者 '+suffix,exact:true}).click();await page.getByRole('button',{name:'冻结账号',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});await page.getByRole('button',{name:'管理 虚构档案删除作者 '+suffix,exact:true}).waitFor({state:'detached'});
 assert.ok(!(await v.call('list_members')).members.some(m=>m.id===member.id));assert.ok((await v.http('/admin/members?state=frozen&limit=100')).body.members.some(m=>m.id===member.id));await page.screenshot({path:out+'/desktop-active-members.png'});
 await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'已冻结',exact:true}).click();await page.getByText('正在读取账号…',{exact:true}).waitFor({state:'detached'});await findManaged();await page.getByRole('button',{name:'管理 虚构档案删除作者 '+suffix,exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/mobile-frozen-members.png'});await page.getByRole('button',{name:'管理 虚构档案删除作者 '+suffix,exact:true}).click();await page.getByRole('button',{name:'解冻账号',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});await page.getByRole('button',{name:'管理 虚构档案删除作者 '+suffix,exact:true}).waitFor({state:'detached'});await page.getByRole('tab',{name:'可用账号',exact:true}).click();await page.getByText('正在读取账号…',{exact:true}).waitFor({state:'detached'});await findManaged();
 checks.push('desktop freeze removes the account from the default list; mobile frozen view supports paging and unfreeze restores the same account to the active list');assert.deepEqual(errors,[]);
}catch(error){if(page)await page.screenshot({path:out+'/failure.png'});throw error;}finally{
 if(browser)await browser.close();
 for(const id of created){try{const current=(await v.call('get_archive',{id})).archive;if(!current.deleted)await v.call('delete_archive',{id,expected_version:current.version,request_id:uuid()});}catch(error){console.error('Fixture cleanup failed:',error.message);}}
 if(member){const current=(await v.call('get_member',{id:member.id})).member;await v.call('set_member_frozen',{id:member.id,expected_version:current.version,frozen:true,request_id:uuid()});}
 await v.close(checks);
}
