import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('mcp-agent-flow'),checks=[];
let archive,task,browser;
try{
 const title='虚构 MCP 闭环核对 '+uuid().slice(0,8);
 assert.equal((await v.call('list_archives',{type:'person',query:title})).archives.length,0);
 archive=await v.call('create_archive',{type:'person',name:title,status:'个人接触',request_id:uuid()});
 const input={archive_id:archive.id,kind:'custom',title,purpose:'检查 Agent 能否从档案完成任务闭环',delivery:'留存一条明确标为虚构的观察并引用其版本',deadline_at:new Date(Date.now()+7*86400000).toISOString(),request_id:uuid()};
 task=await v.call('create_work_task',input);
 assert.equal((await v.call('create_work_task',input)).id,task.id);
 assert.equal((await v.call('get_request_result',{request_id:input.request_id})).status,'completed');
 const list=await v.call('list_work_tasks',{archive_id:archive.id,state:'open'});assert.equal(list.tasks.length,1);
 checks.push('archive search/create → task create/list; same request replay creates one task; receipt lookup succeeds');
 task=await v.call('claim_work_task',{id:task.id,expected_version:task.version,request_id:uuid()});
 const stale=await v.client.callTool({name:'edit_work_task',arguments:{id:task.id,expected_version:1,title:'不应保存',request_id:uuid()}});
 assert.ok(stale.isError);assert.equal(stale.structuredContent.error.code,'VERSION_CONFLICT');
 const detail=await v.call('get_work_task',{id:task.id});assert.equal(detail.task.title,title);
 task=await v.call('edit_work_task',{id:task.id,expected_version:detail.task.version,priority:'P1',request_id:uuid()});
 checks.push('claim → stale edit rejected → reread version → authorized edit succeeds');
 const observation=await v.call('create_observation',{archive_id:archive.id,body:'虚构验收：已核对资料，仅用于 MCP 操作链路验证，不代表真实接触。',request_id:uuid()});
 const read=await v.call('get_observation',{id:observation.id});assert.equal(read.observation.content_version,observation.content_version);
 const reference={observation_id:observation.id,content_version:observation.content_version};
 await v.call('add_work_task_comment',{task_id:task.id,body:'虚构核对完成，准备提交。',references:[reference],request_id:uuid()});
 const page1=await v.call('list_work_task_history',{id:task.id,section:'events',limit:1});assert.ok(page1.next_cursor);
 const page2=await v.call('list_work_task_history',{id:task.id,section:'events',limit:1,cursor:page1.next_cursor});assert.equal(page2.items.length,1);assert.notEqual(page1.items[0].id,page2.items[0].id);checks.push('SDK history cursor advances without duplicate events');
 const fresh=(await v.call('get_work_task',{id:task.id})).task;
 task=await v.call('complete_work_task',{id:task.id,expected_version:fresh.version,result_kind:'completed',result_text:'虚构验收完成，结果见关联观察。',references:[reference],request_id:uuid()});
 assert.equal((await v.call('list_work_tasks',{archive_id:archive.id,state:'open'})).tasks.length,0);
 const completed=await v.call('get_work_task',{id:task.id});assert.equal(completed.task.status,'completed');assert.equal(completed.task.result_references.length,1);
 checks.push('observation → version reference → comment → delivery → closed task with stable history');
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const [name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);
 const page=await context.newPage();await page.goto(v.base+'/tasks?task='+task.id);
 await page.getByText(title,{exact:true}).last().waitFor();
 await page.getByText('虚构验收完成，结果见关联观察。',{exact:true}).first().waitFor();
 await page.screenshot({path:'tmp/verification/mcp-agent-flow-web.png'});
 checks.push('independent browser displays MCP-created completed task and result');
 console.log(JSON.stringify({checks,conflict_error:stale.structuredContent.error}));
}finally{
 try{
  if(browser)await browser.close();
  if(task){const current=(await v.call('get_work_task',{id:task.id})).task;if(current.status==='open')await v.call('cancel_work_task',{id:task.id,expected_version:current.version,reason:'结束虚构验收',request_id:uuid()});}
  if(archive){let a=(await v.call('get_archive',{id:archive.id})).archive;if(!a.closed){await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:uuid()});a=(await v.call('get_archive',{id:a.id})).archive;}await v.call('delete_archive',{id:a.id,expected_version:a.version,request_id:uuid()});}
 }finally{await v.close(checks);}
}
