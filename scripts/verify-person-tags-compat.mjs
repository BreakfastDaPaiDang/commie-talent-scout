import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {verificationClient} from './verification-client.mjs';

// S10/S06 joint check: one person archive and one type=person vocabulary survive
// the external-person -> joined-member transition without copying IDs or tags.
const v=await verificationClient('person-tags-compat'),checks=[];
let archive,observation,browser,category,tag;
const suffix=randomUUID().slice(0,8);
const name='\u865a\u6784\u8eab\u4efd\u5207\u6362 '+suffix;
const categoryName='\u865a\u6784\u4eba\u7269\u7279\u5f81 '+suffix;
const tagName='\u4fdd\u7559\u4e2a\u6027\u8bcd\u6761 '+suffix;
try{
  category=await v.call('create_tag_category',{type:'person',name:categoryName,description:'\u4eba\u7269\u4e0e\u793e\u5458\u5171\u7528\u7684\u865a\u6784\u8bcd\u4e49',request_id:randomUUID()});
  tag=await v.call('create_tag',{category_id:category.id,name:tagName,description:'\u4ec5\u8bb0\u5f55\u5bf9\u8c61\u7684\u4e2a\u6027\u5316\u7279\u5f81',request_id:randomUUID()});
  archive=(await v.call('create_archive',{type:'person',name,status:'\u4e2a\u4eba\u63a5\u89e6',request_id:randomUUID()}));
  observation=await v.call('create_observation',{archive_id:archive.id,body:'\u865a\u6784\u516c\u5f00\u6750\u6599\uff1a\u8bb0\u5f55\u4e2a\u6027\u7279\u5f81\u4f9b\u8bcd\u6761\u4f9d\u636e\u3002',request_id:randomUUID()});
  await v.call('get_observation',{id:observation.id});
  const archiveBeforeTags=(await v.call('get_archive',{id:archive.id})).archive; const tagged=await v.call('update_archive_tags',{archive_id:archive.id,expected_version:archiveBeforeTags.version,changes:[{tag_id:tag.id,action:'add',evidence:[{kind:'observation',observation_id:observation.id,content_version:1,note:'\u4f9d\u636e\u4e2d\u660e\u786e\u8bb0\u5f55\u8be5\u7279\u5f81'}]}],request_id:randomUUID()});
  assert.equal(tagged.changed,true);
  const before=(await v.call('get_archive_tags',{archive_id:archive.id})).tags;
  assert.equal(before.length,1);assert.equal(before[0].type,'person');assert.equal(before[0].tag_id,tag.id);
  const switched=await v.call('set_archive_state',{id:archive.id,expected_version:tagged.version,status:'\u5df2\u5165\u4f19',member_ids:[v.actor.id],request_id:randomUUID()});
  assert.equal(switched.status,'\u5df2\u5165\u4f19');
  const after=(await v.call('get_archive',{id:archive.id})).archive;
  assert.equal(after.id,archive.id);assert.equal(after.type,'person');assert.equal(after.status,'\u5df2\u5165\u4f19');
  const memberTags=(await v.call('get_archive_tags',{archive_id:archive.id})).tags;
  assert.equal(memberTags.length,1);assert.equal(memberTags[0].tag_id,tag.id);assert.equal(memberTags[0].type,'person');
  assert.equal((await v.call('list_archives',{type:'person',person_scope:'members',query:name})).archives.length,1);
  assert.equal((await v.call('list_archives',{type:'person',person_scope:'external',query:name})).archives.length,0);
  checks.push('MCP keeps one person archive ID, one person vocabulary ID, binding evidence, and source type across external-to-member transition');

  browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'});
  const [cookieName,...cookieValue]=v.sessionCookie.split('=');
  await context.addCookies([{name:cookieName,value:cookieValue.join('='),url:v.base}]);
  const page=await context.newPage();
  await page.goto(v.base+'/?archive='+archive.id);
  await page.locator('.entity-heading h1').filter({hasText:name}).waitFor();
  await page.locator('.archive-tags').getByText(tagName,{exact:true}).waitFor();
  assert.match(await page.locator('.entity-heading .state-badge').textContent(),/\u5df2\u5165\u4f19/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`tmp/verification/person-tags-compat-${v.target}-member.png`});
  checks.push('shared mobile archive detail shows the same person tag after the member status switch');
}finally{
  if(browser)await browser.close();
  if(archive){const current=(await v.call('get_archive',{id:archive.id})).archive;if(!current.closed)await v.call('set_archive_state',{id:archive.id,expected_version:current.version,status:'\u5df2\u5f03\u7528',member_ids:[],request_id:randomUUID()});const latest=(await v.call('get_archive',{id:archive.id})).archive;await v.call('delete_archive',{id:archive.id,expected_version:latest.version,request_id:randomUUID()});}
  await v.close(checks);
}
