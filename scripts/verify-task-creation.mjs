import assert from 'node:assert/strict';

export async function verifyTaskCreation({page, base, f, name, archiveId}) {
  const monthlyCount = () => f.sqlite.prepare("SELECT count(*) AS n FROM work_tasks WHERE archive_id=? AND kind='monthly'").get(archiveId).n;
  const monthTask = f.sqlite.prepare("SELECT id FROM work_tasks WHERE kind='monthly' AND archive_id=?").get(archiveId);
  if (!monthTask) {
    const {generateMemberMonthlyFollowUps} = await import('../app/server/member-monthly-follow-ups.ts');
    await generateMemberMonthlyFollowUps(f.env, f.actor, {archive_ids:[archiveId], request_id:crypto.randomUUID()});
  }
  const before = monthlyCount();
  assert.ok(before > 0);
  await page.setViewportSize({width:390, height:844});
  await page.goto(base + '/');
  const create = page.getByRole('dialog',{name:'发布任务'});
  await page.getByRole('button',{name:'新建',exact:true}).click();
  await create.getByLabel('任务类型').selectOption('onboarding');
  await create.getByRole('searchbox',{name:'相关对象'}).fill(name);
  await create.getByRole('button',{name:name+' · 社员',exact:true}).click();
  assert.equal(await create.getByLabel('标题',{exact:true}).inputValue(),name + '的工作对接');
  await create.getByLabel('要处理什么').fill('安排测试项目的第一次协作');
  page.once('dialog', dialog => dialog.dismiss());
  await create.getByLabel('任务类型').selectOption('monthly');
  assert.equal(await create.getByLabel('要处理什么').inputValue(),'安排测试项目的第一次协作');
  assert.equal(await create.getByLabel('任务类型').inputValue(),'onboarding');
  assert.ok(await create.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await create.getByRole('button',{name:'发布任务',exact:true}).click();
  await create.waitFor({state:'detached'});
  const linked = f.sqlite.prepare('SELECT id,purpose,delivery FROM work_tasks WHERE title=? AND archive_id=?').get(name+'的工作对接',archiveId);
  assert.equal(linked.purpose,'安排测试项目的第一次协作');
  assert.match(linked.delivery,/已经开始做的具体工作/);
  assert.equal(monthlyCount(), before);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'新建',exact:true}).click();
  await create.getByLabel('标题',{exact:true}).fill('补关联操作验收');
  await create.getByLabel('要处理什么').fill('补上相关人物');
  await create.getByRole('button',{name:'发布任务',exact:true}).click();
  await create.waitFor({state:'detached'});
  const {id} = f.sqlite.prepare('SELECT id FROM work_tasks WHERE title=? AND archive_id IS NULL').get('补关联操作验收');
  await page.goto(base+'/tasks?task='+id);
  await page.getByRole('button',{name:'编辑任务',exact:true}).click();
  const edit = page.getByRole('dialog',{name:'编辑任务'});
  await edit.getByRole('searchbox',{name:'相关对象'}).fill(name);
  await edit.getByRole('button',{name:name+' · 社员',exact:true}).click();
  await edit.getByRole('button',{name:'保存任务',exact:true}).click();
  await edit.waitFor({state:'detached'});
  await page.reload();
  await page.getByRole('button',{name:'编辑任务',exact:true}).waitFor();
  assert.equal(f.sqlite.prepare('SELECT archive_id FROM work_tasks WHERE id=?').get(id).archive_id,archiveId);
}
