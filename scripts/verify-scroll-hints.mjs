import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Archives} from '../app/server/archives.ts';

export async function verifyScrollHints({page,f,base}){
 const out='tmp/verification/scroll-hints';mkdirSync(out,{recursive:true});
 for(let i=1;i<=12;i++){
  await new Archives(f.env,f.actor,'web').create({type:'person',name:`滚动验收${String(i).padStart(2,'0')}`,request_id:randomUUID()});
  f.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,?)").run(randomUUID(),`scroll-${i}`,`滚动组员${i}`,new Date().toISOString());
 }
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1080});await page.goto(base+'/statistics');
  const list=page.getByLabel('完整经历列表',{exact:true}),hint=page.locator('.wo-main>.scroll-region-hint');
  await hint.getByRole('button',{name:'向下查看完整经历列表',exact:true}).waitFor();assert.match(await hint.innerText(),/显示 1–\d+ \/ 共 \d+ 条/);
  assert.ok(await list.evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight<=350));
  await page.locator('.wo-main').screenshot({path:`${out}/timeline-${width}.png`});
  await hint.getByRole('button').click();await page.waitForFunction(()=>document.querySelector('.wo-timeline-scroll').scrollTop>0);
  await list.focus();await list.press('End');await hint.getByText('已到底',{exact:true}).waitFor();assert.equal(await hint.getByRole('button').count(),0);
  await page.locator('.wo-main').screenshot({path:`${out}/timeline-end-${width}.png`});
  await page.getByPlaceholder('搜索名称',{exact:true}).fill('滚动验收01');await page.waitForFunction(()=>document.querySelectorAll('.wo-row').length===1&&!document.querySelector('.wo-main>.scroll-region-hint'));
  const members=page.getByLabel('成员明细',{exact:true}),memberHint=page.locator('.statistics-details>.scroll-region-hint');
  await memberHint.getByRole('button',{name:'向下查看成员明细',exact:true}).waitFor();assert.ok(await members.evaluate(el=>el.scrollHeight>el.clientHeight));
  await members.focus();await members.press('End');await memberHint.getByText('已到底',{exact:true}).waitFor();
  await page.locator('.statistics-details').screenshot({path:`${out}/members-${width}.png`});
  await page.getByText('查看逐期数据',{exact:true}).click();const periods=page.getByLabel('逐期数据',{exact:true});await periods.waitFor();await page.locator('.statistics-periods>.scroll-region-hint').getByRole('button').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('.wo-row .wo-segment').first().click();await page.getByRole('button',{name:'编辑本段落实',exact:true}).click();await page.getByRole('form',{name:'编辑本段落实',exact:true}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();await page.keyboard.press('Escape');
 }
 console.log('scroll-hints: bounded desktop/mobile lists, range/count, button/keyboard scrolling, end state, filtering and editor passed');
}
