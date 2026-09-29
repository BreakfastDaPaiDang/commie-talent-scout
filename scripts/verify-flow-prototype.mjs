import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.CTS_FLOW_BASE??'http://127.0.0.1:5181',out='tmp/verification/flow-prototype';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true}),checks=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:1600,height:1050},timezoneId:'Asia/Shanghai'});page.on('pageerror',e=>errors.push(e.message));
 async function shot(name){await page.evaluate(()=>document.fonts.ready);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page must not overflow');await page.screenshot({path:`${out}/${name}.png`,fullPage:true});}
 const button=name=>page.getByRole('button',{name,exact:true});
 await page.goto(base+'/?flow=1');await button('领取审核').waitFor();await shot('desktop-initial');
 await button('领取审核').click();await button('完成审核').click();await page.getByRole('textbox',{name:'留档结果（可选）',exact:true}).fill('虚构审核结果：已说明协作安排，对方明确表达加入意愿。');await button('确认完成').click();
 assert.equal(await page.locator('.fw-profile').textContent().then(s=>s.includes('个人接触')),true);await button('确认入社').click();await shot('join-preview');await button('确认入社并查看下一步').click();
 await page.locator('.primary-nav button[aria-current=page]').filter({hasText:'社员'}).waitFor();assert.match(await page.locator('.fw-profile').textContent(),/林澈.*社员.*待入社对接/);await button('领取对接').waitFor();await shot('member-handoff');
 await page.getByRole('tab',{name:/观察记录/}).click();assert.match(await page.locator('.fw-note').allTextContents().then(x=>x.join(' ')),/9 月 28 日.*虚构审核结果|虚构审核结果.*9 月 28 日/);
 await button('领取对接').click();await button('放弃任务').click();await button('确认交还').click();await button('领取对接').waitFor();
 await page.getByLabel('演示身份',{exact:true}).selectOption('shen');await button('领取对接').click();await button('延期').click();await button('保存新期限').click();
 await page.getByRole('tab',{name:'过程与历史',exact:true}).click();await page.getByRole('textbox',{name:'补充工作说明',exact:true}).fill('虚构评论：已约定明晚继续对接。');await button('发表评论').click();
 await button('完成对接').click();await page.getByRole('textbox',{name:'留档结果（可选）',exact:true}).fill('虚构对接结果：已介绍内容小组、协作入口与后续联系人。');await button('确认完成').click();
 assert.match(await page.locator('.fw-history').textContent(),/周宁主动领取/);assert.match(await page.locator('.fw-history').textContent(),/主动放弃/);assert.match(await page.locator('.fw-history').textContent(),/沈舟主动领取/);assert.match(await page.locator('.fw-history').textContent(),/主动延期/);assert.equal(await page.getByRole('textbox',{name:'补充工作说明',exact:true}).count(),0);await shot('completed-history');
 checks.push('audit completion does not join; explicit join moves the same archive to members, retains notes and creates unclaimed onboarding; surrender, another member pickup, extension, comment and completion retain history');
 await button('收起档案详情').click();await page.getByLabel('演示身份',{exact:true}).selectOption('zhou');await button('任务').click();await button('查看任务：九月近况沟通').click();await button('重新开启任务').click();await button('确认重新开启').click();await button('完成任务').click();await button('确认完成').click();await page.getByRole('tab',{name:'过程与历史',exact:true}).click();assert.match(await page.locator('.fw-history').textContent(),/到期未完成/);assert.match(await page.locator('.fw-history').textContent(),/接取者确认完成/);checks.push('failed task can be reopened by its former owner and completed without erasing failure; direct completion permits no new note');
 await button('收起档案详情').click();await page.getByRole('textbox',{name:'搜索工作台',exact:true}).fill('不存在的虚构对象');assert.equal(await page.getByText('没有匹配的工作',{exact:true}).count(),3);await shot('empty-search');
 for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:900});await page.goto(base+'/?flow=1');await button('收起档案详情').click();await shot(`board-${width}`);await button('查看任务：了解林澈的入社意愿').click();await shot(`detail-${width}`);}
 await button('领取审核').click();await button('完成审核').click();await page.getByRole('textbox',{name:'留档结果（可选）',exact:true}).fill('手机端虚构长文验收。'.repeat(30));await shot('mobile-expanded-form');await button('确认完成').click();await button('确认入社').click();await button('确认入社并查看下一步').click();await button('领取对接').click();await button('完成对接').click();await button('确认完成').click();assert.match(await page.locator('.fw-profile').textContent(),/社员/);await shot('mobile-completed');checks.push('desktop 1600/1440/1024 and tablet/mobile 768/390 have no horizontal overflow; phone completes the entire audit-to-onboarding path with expanded long form');
 assert.deepEqual(errors,[]);writeFileSync(`${out}/report.json`,JSON.stringify({date:new Date().toISOString(),base,checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors}));
}finally{await browser.close();}
