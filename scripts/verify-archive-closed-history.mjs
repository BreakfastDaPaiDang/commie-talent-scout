import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('archive-closed-history'),checks=[],created=[],out='tmp/verification/archive-closed-history';mkdirSync(out,{recursive:true});let browser;
try{
 const suffix=randomUUID().slice(0,8),errors=[];
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),[name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const [type,scope,path,status] of [['person','external','/','个人接触'],['person','members','/members','已入伙'],['org','all','/organizations','个人接触']]){
  const a=await v.call('create_archive',{type,name:`虚构历史筛选 ${suffix} ${scope}`,status,request_id:randomUUID()});created.push(a.id);
  // Use a real closure for external people and organizations. Member lifecycle redesign is outside #76.
  if(scope!=='members')await v.call('set_archive_state',{id:a.id,expected_version:a.version,status:'已弃用',member_ids:[],request_id:randomUUID()});
  for(const range of ['30','90','all']){
   const args={type,person_scope:scope,closed_history:range,query:suffix};const http=await v.http('/archives?'+new URLSearchParams(args)),mcp=await v.call('list_archives',args);assert.equal(http.status,200);assert.deepEqual(http.body.archives.map(x=>x.id),mcp.archives.map(x=>x.id));assert.equal(http.body.counts.all,1);
  }
  await page.goto(v.base+path+'?archive='+a.id);await page.locator('.entity-heading h1').filter({hasText:suffix}).waitFor();
  await page.getByRole('textbox',{name:'搜索档案',exact:true}).fill(suffix);await page.locator('.entity-row').filter({hasText:suffix}).waitFor();
  await page.getByRole('button',{name:'已关闭档案：最近 30 天',exact:true}).click();
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:1000});if(width===390)await page.getByRole('button',{name:'关闭档案详情',exact:true}).click();
   for(const range of ['90','all']){const response=page.waitForResponse(r=>r.url().includes('/api/archives?')&&new URL(r.url()).searchParams.get('closed_history')===range);await page.getByRole('combobox',{name:'已关闭档案',exact:true}).selectOption(range);assert.equal((await response).status(),200);}
   const reset=page.waitForResponse(r=>r.url().includes('/api/archives?')&&new URL(r.url()).searchParams.get('closed_history')==='30');await page.getByRole('button',{name:'重置筛选',exact:true}).click();await reset;
   assert.equal(await page.getByRole('combobox',{name:'已关闭档案',exact:true}).inputValue(),'30');assert.ok(await page.locator('.main-panel').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
   await page.screenshot({path:`${out}/${scope}-${width}-expanded.png`});
   await page.getByRole('button',{name:'筛选',exact:true}).click();await page.getByRole('button',{name:'已关闭档案：最近 30 天',exact:true}).waitFor();await page.screenshot({path:`${out}/${scope}-${width}-collapsed.png`});await page.getByRole('button',{name:'已关闭档案：最近 30 天',exact:true}).click();
  }
  await page.setViewportSize({width:1440,height:1000});checks.push(`${scope}: HTTP/MCP ranges agree; real desktop/mobile selection, reset and collapsed summary pass`);
 }
 assert.deepEqual(errors,[]);checks.push('no browser runtime errors');
}finally{
 await browser?.close();for(const id of created){const a=(await v.call('get_archive',{id})).archive;await v.call('delete_archive',{id,expected_version:a.version,request_id:randomUUID()});}await v.close(checks);
}
