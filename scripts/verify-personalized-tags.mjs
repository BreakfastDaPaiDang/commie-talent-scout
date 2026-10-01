import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {verificationClient} from './verification-client.mjs';

// Only synthetic data in local/staging; ordinary-member web creation and a fresh MCP connection.
const v=await verificationClient('personalized-tags'),checks=[],suffix=randomUUID().slice(0,8);
const categoryName='虚构个性特征'+suffix,tagName='雨声地图偏好'+suffix;
const definition='偏好以雨声标注步行地图的表达方式。',note='2026-09-29 阅读虚构公开作品集，偏好仅指地图表达，未与对象沟通。';
let member,archive,client,browser,page,cookie,connection,tag,category;
async function web(path,body){
 const r=await fetch(v.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:v.base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));
 const next=r.headers.get('set-cookie');if(next)cookie=next.split(';')[0];return data;
}
async function call(name,args={}){const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r.structuredContent));return r.structuredContent;}
async function capture(name){
 await page.evaluate(()=>document.fonts.ready);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
 assert.ok(await page.getByRole('dialog').last().evaluate(e=>e.scrollWidth<=e.clientWidth+1),'no horizontal dialog overflow');
 await page.screenshot({path:`tmp/verification/personalized-tags-${v.target}-${name}.png`});
}
try{
 mkdirSync('tmp/verification',{recursive:true});
 const username='personal-'+suffix,temp='Temp!'+randomUUID(),password='Member!'+randomUUID();
 member=await v.call('create_member',{username,name:'虚构个性标签成员',temporary_password:temp,role:'member',request_id:randomUUID()});
 await web('/auth/login',{username,password:temp});await web('/auth/password',{current_password:temp,new_password:password});await web('/auth/login',{username,password});
 connection=await web('/connections',{name:'虚构个性标签验收',days:1});
 client=new Client({name:'cts-personalized-tags',version:'1.0.0'});
 await client.connect(new StreamableHTTPClientTransport(new URL(v.base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+connection.secret}}}));
 assert.equal((await call('whoami')).member.role,'member');
 const guides=JSON.stringify(await call('get_usage_guide',{topic:'tags'}));
 assert.match(guides,/多人复用不是创建门槛/);assert.match(guides,/绑定依据/);
 assert.match(JSON.stringify(await call('get_usage_guide',{topic:'observations'})),/非接触材料/);
 assert.match((await client.listTools()).tools.find(t=>t.name==='create_tag').description,/不要求多人复用/);
 checks.push('fresh ordinary-member MCP connection discovers personalized-tag and non-contact-source guidance');

 archive=await call('create_archive',{type:'person',name:'虚构雨声地图作者 '+suffix,request_id:randomUUID()});
 const observation=await call('create_observation',{archive_id:archive.id,body:note,request_id:randomUUID()});
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
 const [cookieName,...cookieValue]=cookie.split('=');await context.addCookies([{name:cookieName,value:cookieValue.join('='),url:v.base}]);
 page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(v.base+'/?archive='+archive.id);await page.locator('.record-body').filter({hasText:note}).waitFor();
 await page.getByRole('button',{name:'编辑档案',exact:true}).click();
 let editor=page.getByRole('dialog',{name:'编辑档案',exact:true});await editor.getByRole('tab',{name:'标签',exact:true}).click();await editor.getByRole('button',{name:'＋ 添加',exact:true}).click();
 const chooser=page.getByRole('dialog',{name:'添加标签',exact:true});
 await chooser.getByRole('textbox').fill(tagName);await chooser.getByText('没有找到适用词条，可在下方新建。',{exact:true}).waitFor();
 await chooser.getByRole('button',{name:'没有适用词义？新建标签',exact:true}).click();
 await chooser.locator('.tag-create-form select').selectOption('new');await chooser.getByLabel('类别名称',{exact:true}).fill(categoryName);
 await chooser.locator('.tag-create-form textarea').fill(definition);
 assert.match(await chooser.locator('.tag-create-form textarea').getAttribute('placeholder'),/仅适用于一个对象/);
 await capture('desktop-create');await page.setViewportSize({width:390,height:844});await capture('mobile-create');
 await chooser.getByRole('button',{name:'保存词条',exact:true}).click();await chooser.waitFor({state:'detached'});
 await editor.getByRole('button',{name:'关闭对话框',exact:true}).click();await editor.waitFor({state:'detached'});
 tag=(await call('list_tags',{type:'person',query:tagName})).tags.find(t=>t.name===tagName);assert.ok(tag);category={id:tag.category_id};assert.equal(tag.binding_count,1);
 const bound=(await call('get_archive_tags',{archive_id:archive.id})).tags;assert.equal(bound.length,1);assert.equal(bound[0].description,definition);
 checks.push('ordinary member creates and binds a unique term from the real web form, including desktop/mobile expanded form; MCP reads its single binding');

 await page.locator('.archive-tags .tag-binding-button').filter({hasText:tagName}).click();
 let detail=page.getByRole('dialog').last();await detail.getByRole('button',{name:'维护依据',exact:true}).click();
 await detail.getByRole('button',{name:'＋ 补充依据',exact:true}).click();await detail.locator('fieldset select').nth(0).selectOption('observation');
 await detail.getByLabel('说明',{exact:true}).fill(note);await detail.locator('fieldset select').nth(1).selectOption(observation.id);
 await capture('mobile-evidence');await detail.getByRole('button',{name:'保存依据',exact:true}).click();await detail.waitFor({state:'detached'});
 const read=await call('get_observation',{id:observation.id});assert.equal(read.observation.author_id,member.id);assert.equal(read.observation.body,note);
 let current=await call('get_archive_tags',{archive_id:archive.id});assert.equal(current.tags[0].evidence[0].observation_id,observation.id);assert.ok(current.tags[0].confirmed_at);
 const revised=note+' 范围补充：只说明作品表达偏好，不推定与任何人的协作意愿。';
 await call('update_archive_tags',{archive_id:archive.id,expected_version:current.version,changes:[{tag_id:tag.id,action:'evidence',evidence:[{kind:'observation',note:revised,observation_id:observation.id,content_version:1}]}],request_id:randomUUID()});
 const events=(await call('list_archive_events',{id:archive.id})).events;
 const source=events.find(e=>e.observation_id===observation.id);assert.equal(source.source,'mcp');assert.equal(source.actor_id,member.id);
 const revision=events.find(e=>e.kind==='archive.tags_changed');assert.equal(revision.before[0].evidence[0].note,note);assert.equal(revision.after[0].evidence[0].note,revised);
 await call('create_observation',{archive_id:archive.id,body:'虚构后续动态：更新了一张路线图，本次材料没有说明偏好是否变化。',request_id:randomUUID()});
 current=await call('get_archive_tags',{archive_id:archive.id});assert.equal(current.tags.length,1);assert.equal(current.tags[0].evidence[0].note,revised);
 await page.reload();await page.locator('.archive-tags .tag-binding-button').filter({hasText:tagName}).click();detail=page.getByRole('dialog').last();
 await detail.getByText(revised,{exact:true}).waitFor();await detail.getByRole('button',{name:'查看来源 · 版本 1',exact:true}).click();
 await page.getByRole('dialog').last().getByText(note,{exact:true}).waitFor();await page.keyboard.press('Escape');
 await capture('mobile-detail');await page.setViewportSize({width:1440,height:1000});await capture('desktop-detail');await page.keyboard.press('Escape');
 checks.push('web evidence and MCP revision preserve source/version, confirmation, prior evidence and MCP submitter; unrelated new observation keeps the tag; web reads the exact source');

 const preview=await call('preview_tag_definition',{change:{entity_type:'tag',id:tag.id,category_id:category.id,name:tagName,description:definition+' 不表示协作意愿。',reason:'澄清原词义边界'}});
 await call('apply_tag_definition',{preview_id:preview.preview_id,request_id:randomUUID()});
 const definitions=await call('get_tag_definition',{entity_type:'tag',id:tag.id});assert.equal(definitions.history.length,2);assert.equal(definitions.history[1].definition.description,definition);
 await page.goto(v.base+'/tags');await page.getByRole('textbox',{name:'查找已有词义',exact:true}).fill(tagName);
 await page.locator('.tag-choice-list article').filter({hasText:tagName}).getByRole('button',{name:'查看与维护',exact:true}).click();
 detail=page.getByRole('dialog').last();await detail.getByRole('tab',{name:'定义历史',exact:true}).click();await detail.getByText(definition,{exact:true}).waitFor();await capture('definition-history');
 await detail.getByRole('tab',{name:'词义',exact:true}).click();await detail.getByRole('button',{name:'更名或澄清词义',exact:true}).click();
 assert.equal(await detail.locator('.definition-form textarea').inputValue(),definition+' 不表示协作意愿。');await capture('definition-editor');
 assert.deepEqual(errors,[]);checks.push('MCP definition clarification retains old definition, and the real web history and maintenance form show the same meaning');
}catch(error){
 if(page){await page.screenshot({path:`tmp/verification/personalized-tags-${v.target}-failure.png`});console.error(JSON.stringify({dialogs:await page.getByRole('dialog').allTextContents()}));}
 throw error;
}finally{
 if(browser)await browser.close();
 if(client)await client.close();
 if(connection)await web('/connections/revoke',{id:connection.id});
 if(cookie)await web('/auth/logout',{});
 if(!tag){const found=(await v.call('list_tags',{type:'person',query:tagName})).tags.find(t=>t.name===tagName);if(found)tag=found;}
 if(!category){category=(await v.call('list_tag_categories',{type:'person'})).categories.find(c=>c.name===categoryName);}
 for(const subject of [{entity_type:'tag',id:tag?.id},{entity_type:'category',id:category?.id}].filter(s=>s.id)){
  const preview=await v.call('preview_tag_deletion',{...subject,deleted:true,reason:'清理本次虚构个性标签验收'});if(preview.changed)await v.call('apply_tag_deletion',{preview_id:preview.preview_id,request_id:randomUUID()});
 }
 if(archive){const current=(await v.call('get_archive',{id:archive.id})).archive;await v.call('delete_archive',{id:archive.id,expected_version:current.version,request_id:randomUUID()});}
 if(member){const current=(await v.call('get_member',{id:member.id})).member;await v.call('set_member_frozen',{id:member.id,expected_version:current.version,frozen:true,request_id:randomUUID()});}
 await v.close(checks);
}
