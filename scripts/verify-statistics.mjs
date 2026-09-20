import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

const v=await verificationClient('statistics'),checks=[],created=[];
const out='tmp/verification/statistics';mkdirSync(out,{recursive:true});
let browser;
try {
  assert.equal((await fetch(v.base+'/api/statistics')).status,401);
  assert.equal((await fetch(v.base+'/api/statistics/link')).status,401);
  const link=await v.http('/statistics/link');assert.equal(link.status,200);assert.equal(link.body.url,v.base+'/statistics');
  const suffix=randomUUID().slice(0,8),category=await v.call('create_tag_category',{type:'person',name:'统计验收'+suffix,request_id:randomUUID()});
  const tags=[];
  for(const name of ['整理','写作'])tags.push(await v.call('create_tag',{category_id:category.id,name,description:'虚构统计验收标签',request_id:randomUUID()}));
  const archive=await v.call('create_archive',{type:'person',name:'虚构统计验收'+suffix,request_id:randomUUID()});created.push(archive.id);
  for(let i=0;i<3;i++)await v.call('create_observation',{archive_id:archive.id,body:'虚构统计验收记录 '+i,request_id:randomUUID()});
  let current=(await v.call('get_archive',{id:archive.id})).archive;
  const binding=await v.http('/archive-tags/update',{archive_id:archive.id,expected_version:current.version,changes:tags.map(t=>({tag_id:t.id,action:'add'})),request_id:randomUUID()});
  assert.equal(binding.status,200,JSON.stringify(binding.body));
  const get=async group=>{
    const result=await v.http('/statistics?'+new URLSearchParams({group,search:'统计验收'+suffix}));
    assert.equal(result.status,200);return result.body;
  };
  const tagged=await get('tag');
  assert.equal(tagged.total,3);assert.deepEqual(tagged.series.map(s=>s.total),[3,3]);
  assert.equal((await v.http('/statistics?from=2026-09-20&to=2026-09-01')).status,400);
  checks.push('authenticated HTTP aggregation, cross-tag deduplication and invalid dates');
  browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Los_Angeles'});
  const [name,...value]=v.sessionCookie.split('=');await context.addCookies([{name,value:value.join('='),url:v.base}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(v.base+'/statistics');await page.getByRole('heading',{name:'统计仪表盘',exact:true}).waitFor();
  await page.locator('.statistics-summary').waitFor();
  await page.getByRole('button',{name:'标签优先',exact:true}).click();await page.locator('.statistics-summary').waitFor();
  await page.getByLabel('搜索分组',{exact:true}).fill('统计验收'+suffix);await page.getByRole('button',{name:'应用筛选',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.statistics-summary strong')?.textContent==='3');
  assert.equal(await page.locator('.statistics-details tbody tr').count(),2);
  await page.getByRole('button',{name:'累计',exact:true}).click();
  await page.getByText('查看逐期数据',{exact:true}).click();
  assert.equal(await page.locator('.statistics-periods tbody tr').last().locator('td').first().textContent(),'3');
  await page.getByText('查看逐期数据',{exact:true}).click();
  for(const width of [1920,1440,1024,390]){
    await page.setViewportSize({width,height:width<600?844:1000});await page.evaluate(()=>document.fonts.ready);
    await page.locator('.statistics-page').evaluate(e=>e.scrollTop=0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
    const overlap=await page.evaluate(()=>{const nav=document.querySelector('.primary-nav').getBoundingClientRect(),tools=document.querySelector('.topbar-tools').getBoundingClientRect();return tools.width>0&&nav.right>tools.left+1&&nav.top<tools.bottom&&nav.bottom>tools.top;});
    assert.equal(overlap,false,`navigation overlap at ${width}`);
    await page.screenshot({path:`${out}/dashboard-${width}.png`});
  }
  await page.getByLabel('时间粒度',{exact:true}).selectOption('week');await page.getByRole('button',{name:'应用筛选',exact:true}).click();await page.locator('.statistics-summary').waitFor();
  await page.getByText('查看逐期数据',{exact:true}).click();assert.ok(await page.locator('.statistics-periods tbody tr').count()<=6);
  await page.getByLabel('搜索分组',{exact:true}).fill('没有这样的分组'+suffix);await page.getByRole('button',{name:'应用筛选',exact:true}).click();await page.getByText('没有匹配的分组',{exact:true}).waitFor();
  await page.screenshot({path:out+'/empty-mobile.png'});
  await page.route('**/api/statistics?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'验收网络失败'}})}));
  await page.getByRole('button',{name:'刷新统计',exact:true}).click();await page.getByRole('alert').filter({hasText:'验收网络失败'}).waitFor();
  assert.equal(await page.locator('.statistics-summary').count(),0);
  await page.unroute('**/api/statistics?**');await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('没有匹配的分组',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  checks.push('desktop/mobile navigation, cumulative counts, weekly axis, empty results, retry and no stale statistics on failure');
  writeFileSync(out+'/report.json',JSON.stringify({checks,errors},null,2));
} finally {
  if(browser)await browser.close();
  for(const id of created){const archive=(await v.call('get_archive',{id})).archive;await v.http('/archives/delete',{id,expected_version:archive.version,request_id:randomUUID()});}
  await v.close(checks);
}
