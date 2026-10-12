import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {verificationClient} from './verification-client.mjs';

const v=await verificationClient('notifications'),checks=[];let reader,connection,client,browser,archive,task,cookie;
const http=async(path,body)=>{const r=await fetch(v.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:v.base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];assert.equal(r.status,200,path);return r.json();};
try{
 const username='notification-'+uuid().slice(0,8),password='Fixture!'+uuid();reader=await v.call('create_member',{username,name:'虚构统一消息读者',temporary_password:password,request_id:uuid()});await http('/auth/login',{username,password});const permanent='Fixture!'+uuid();await http('/auth/password',{current_password:password,new_password:permanent});await http('/auth/login',{username,password:permanent});
 connection=await http('/connections',{name:'统一消息验收',days:1});client=new Client({name:'notification-test',version:'1.0.0'});await client.connect(new StreamableHTTPClientTransport(new URL(v.base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+connection.secret}}}));
 const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r.structuredContent));return r.structuredContent;};
 const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='list_notifications'));
 archive=await v.call('create_archive',{type:'person',name:'虚构统一消息 '+uuid().slice(0,8),request_id:uuid()});
 task=await v.call('create_work_task',{kind:'cooperation',archive_id:archive.id,title:'虚构消息协作任务',purpose:'核对两种消息',delivery:'本地验收',deadline_at:new Date(Date.now()+86400000*3).toISOString(),request_id:uuid()});
 await call('claim_work_task',{id:task.id,expected_version:task.version,request_id:uuid()});
 let a=(await v.call('get_archive',{id:archive.id})).archive;await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'外部社友',member_ids:[],request_id:uuid()});
 const web=await http('/notifications?unread=true'),mcp=await call('list_notifications',{unread:true});assert.deepEqual(web,mcp);assert.ok(web.notifications.some(n=>n.source==='task'));assert.ok(web.notifications.some(n=>n.source==='archive'));assert.deepEqual(await http('/notifications/summary'),await call('get_notification_summary'));checks.push('HTTP/MCP share mixed feed, source metadata and counts; tools/list accepts unified schemas');
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),[name,...value]=cookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 mkdirSync('tmp/verification/notifications',{recursive:true});
 await page.goto(v.base+'/tasks');await page.getByRole('button',{name:'未读更新',exact:true}).click();await page.getByRole('heading',{name:'消息',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'档案更新',exact:true}).count(),0);
 const taskRow=page.locator('.inbox-list .update-row').filter({hasText:'对象状态变化'});await taskRow.first().click();await page.getByRole('button',{name:'查看任务',exact:true}).waitFor();await page.goBack();await page.waitForFunction(()=>!new URLSearchParams(location.search).has('notification'));assert.equal(new URL(page.url()).pathname,'/messages');assert.equal(await page.getByRole('button',{name:'查看任务',exact:true}).count(),0);await page.goForward();await page.getByRole('button',{name:'查看任务',exact:true}).waitFor();
 await page.getByRole('button',{name:'查看任务',exact:true}).click();await page.waitForURL('**/tasks?task=*');await page.goBack();await page.getByRole('button',{name:'查看任务',exact:true}).waitFor();await page.getByRole('button',{name:'关闭档案详情',exact:true}).click();
 await page.locator('.inbox-list .update-row').filter({hasText:archive.name??'虚构统一消息'}).filter({hasText:'档案更新'}).first().click();await page.locator('.entity-heading h1').waitFor();await page.waitForFunction(()=>!document.querySelector('.nav-unread'));assert.equal((await call('get_notification_summary')).total,0);assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'message workspace must not scroll the top navigation offscreen');
 await page.screenshot({path:'tmp/verification/notifications/desktop.png'});
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'编辑档案',exact:true}).click();const editor=page.getByRole('dialog',{name:'编辑档案',exact:true});await editor.waitFor();await editor.getByRole('textbox',{name:'昵称',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`tmp/verification/notifications/editor-${width}.png`});await page.keyboard.press('Escape');await editor.waitFor({state:'detached'});}await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'关闭档案详情',exact:true}).click();
 checks.push('Unified desktop feed; detail close, browser back/forward, task link return and archive acknowledgement share one route and no document overflow');
 await v.call('create_observation',{archive_id:archive.id,body:'虚构手机消息确认',request_id:uuid()});await page.setViewportSize({width:390,height:844});await page.goto(v.base+'/messages?tab=updates');await page.locator('.inbox-list .update-row').first().waitFor();
 let release;const held=new Promise(resolve=>release=resolve);await page.route('**/api/archives/'+archive.id,async route=>{await held;await route.continue().catch(()=>{});});
 await page.locator('.inbox-list .update-row').filter({hasText:'档案更新'}).first().click();await page.getByText('正在打开档案…',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭档案详情',exact:true}).click();release();await page.unrouteAll({behavior:'wait'});await page.locator('.inbox-list .update-row').first().waitFor();await page.waitForTimeout(250);assert.equal(await page.locator('.entity-heading h1').count(),0,'late detail response must not reopen closed detail');
 await page.getByRole('button',{name:'全部标为已读',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.nav-unread'));assert.equal((await call('get_notification_summary')).total,0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1));await page.screenshot({path:'tmp/verification/notifications/mobile.png'});
 await v.call('create_observation',{archive_id:archive.id,body:'标记完成后新消息仍应未读',request_id:uuid()});assert.equal((await call('get_notification_summary')).reading,1);
 await page.getByRole('button',{name:'刷新消息',exact:true}).click();await page.locator('.inbox-list .update-row').filter({hasText:'未读'}).first().waitFor();
 assert.deepEqual(errors,[]);checks.push('Mobile list, slow request cancellation, all-read and bell sync; later updates stay unread; legacy URL supported');
}finally{
 if(browser)await browser.close();if(client)await client.close();
 if(task){const current=(await v.call('get_work_task',{id:task.id})).task;if(current.status==='open')await v.call('cancel_work_task',{id:task.id,expected_version:current.version,reason:'虚构验收结束',request_id:uuid()});}
 if(archive){const a=(await v.call('get_archive',{id:archive.id})).archive;if(!a.closed)await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:uuid()});const c=(await v.call('get_archive',{id:archive.id})).archive;await v.call('delete_archive',{id:c.id,expected_version:c.version,request_id:uuid()});}
 if(connection)await http('/connections/revoke',{id:connection.id});if(cookie)await http('/auth/logout',{});
 if(reader){const m=(await v.call('get_member',{id:reader.id})).member;await v.call('set_member_frozen',{id:m.id,expected_version:m.version,frozen:true,request_id:uuid()});}await v.close(checks);
}
