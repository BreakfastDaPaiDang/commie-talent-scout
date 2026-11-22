import assert from 'node:assert/strict';

export async function verifyMemberBackfill(page,base) {
  const button = name=>page.getByRole('button',{name,exact:true});
  const form=page.locator('form.manage-form');
  for (const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900});
    await page.goto(base+'/tasks');
    if (width===1440) await page.locator('summary.current-member').click();
    else await button('打开工具导航').click();
    await button('补录历史社员').filter({visible:true}).click();
    await form.getByLabel('社员名称').fill('补录验收'+width);
    await form.getByLabel('QQ',{exact:true}).fill('192000'+width);
    await form.getByLabel('基本状态').selectOption('暂不接工作');
    await form.getByLabel('原入社依据').fill('原人事组的入社记录已核实 '+width);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await button('确认补录').click();
    await button('查看社员档案').click();
    await page.getByRole('heading',{name:'补录验收'+width,exact:true}).last().waitFor();
    await page.reload();
    await page.getByText('原人事组的入社记录已核实 '+width,{exact:true}).last().waitFor();
    assert.equal(new URL(page.url()).pathname,'/members');
  }
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5196/?member-backfill');
  try { await form.getByLabel('原入社依据').waitFor(); }
  catch (error) {
    console.error('Backfill preview:',page.url(),errors,(await page.locator('body').innerText()).slice(0,800));
    throw error;
  }
}
