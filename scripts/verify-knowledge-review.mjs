import assert from 'node:assert/strict';
import {digest} from '../app/server/types.ts';
import {request} from '../knowledge/tests/fixture.mjs';
import {historicalSql} from '../tests/personnel-fixture.mjs';

const day = 24 * 60 * 60 * 1000;
const screen = {width:1440,height:1080};
const viewportFits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const detail = page => page.locator('.kb-review-detail');
const group = (page, title) => page.locator('.kb-todo-group').filter({has:page.getByRole('heading',{name:title,exact:true})});
const entry = (page, title) => page.locator('.kb-entry').filter({has:page.getByRole('heading',{name:title,exact:true})});
const approval = page => page.getByRole('button',{name:'同意此版本',exact:true});

async function saveDraft(writer,title,body,category,visibility='private') {
  const branch=await writer.createBranch({name:title,visibility,request_id:request()});
  const document=await writer.save({branch_id:branch.id,expected_version:branch.version,title,body,category,message:'建立审核验收内容',request_id:request()});
  const version=await writer.document(branch.id,document.id);
  return {branch,document,version};
}

function submit(writer,draft) {
  return writer.submitReview({branch_id:draft.branch.id,expected_version:draft.document.version,document_id:draft.document.id,version_id:draft.version.id,reason:'核对范围和审核截止时间',request_id:request()});
}

async function memberContext(browser,f,actor,base) {
  const at=new Date().toISOString(),session=request(),hash=await digest(session);
  f.p.sqlite.prepare("INSERT INTO members(id,username,name,role,password_hash,must_change_password,created_at) VALUES(?,?,?,'member','fixture',0,?)").run(actor.id,actor.username,actor.name,at);
  historicalSql(f.p,()=>f.p.sqlite.prepare("INSERT INTO archives(id,type,name,status,person_role,member_status,linked_account_id,created_by,created_at,updated_at) VALUES(?,'person',?,'已入伙','member','可接工作',?,?,?,?)").run(actor.membership_id,actor.name,actor.id,actor.id,at,at));
  f.p.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'session','review-ui',1,?,'2099-01-01T00:00:00.000Z')").run(request(),actor.id,hash,at);
  const context=await browser.newContext({viewport:screen});
  await context.addCookies([{name:'cts_session',value:session,url:base}]);
  return context;
}

export async function verifyKnowledgeReviewQueue(page,browser,out,f,services,documentUrl) {
  const [writer,reader,third]=services;
  const base=new URL(documentUrl).origin,workbench=base+'/knowledge';
  const candidateUrl=merge=>workbench+'?'+new URLSearchParams({review:merge.id,head:merge.head_id});
  const submitted=await saveDraft(writer,'审核候选：项目交接','交接时请留下可核对的项目链接。','组织');
  const ending=await saveDraft(writer,'审核候选：活动报名','回读提交时间，再安排报名确认。','知性');
  const draft=await saveDraft(writer,'个人草稿：交接记录','仅作者可见的交接记录。','组织');
  const foreign=await saveDraft(reader,'成员私稿：报名备注','仅另一名成员可读。','知性');
  const publicReview=await submit(writer,submitted);
  const endingReview=await submit(writer,ending);
  const deadline=new Date(Date.now()+2*day).toISOString();
  f.k.sqlite.prepare('UPDATE kw_merges SET expires_at=? WHERE id=?').run(deadline,endingReview.id);

  await page.goto(workbench);
  const scopes=page.getByRole('navigation',{name:'知识库范围'});
  await scopes.getByRole('button',{name:'待办',exact:true}).waitFor();
  assert.deepEqual(await scopes.getByRole('button').allTextContents(),['待办','已入库']);
  assert.equal(await scopes.getByRole('button',{name:'待办',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.kb-branch-box,.kb-graph,.kb-content-tabs').count(),0);
  const needed=group(page,'我需认可');
  await needed.locator('.kb-entry').filter({hasText:submitted.version.title}).waitFor();
  await group(page,'我的草稿').locator('.kb-entry').filter({hasText:draft.version.title}).waitFor();
  assert.equal(await entry(page,foreign.version.title).count(),0);
  assert.equal(await entry(page,submitted.version.title).locator('time').getAttribute('datetime'),publicReview.expires_at);
  assert.equal(await entry(page,ending.version.title).locator('time').getAttribute('datetime'),deadline);
  assert.equal(Date.parse(publicReview.expires_at)-Date.parse((await writer.mergeRequest(publicReview.id)).created_at),7*day);
  await page.screenshot({path:out+'/todo-desktop.png',fullPage:true});

  await entry(page,submitted.version.title).click();
  await detail(page).getByText(submitted.version.body,{exact:true}).waitFor();
  assert.equal(await detail(page).locator('.kb-diff-columns').count(),0);
  assert.equal(await detail(page).getByText(submitted.version.title,{exact:true}).count(),1);
  assert.equal((await detail(page).innerText()).includes(publicReview.head_id.slice(0,8)),false);
  await detail(page).getByRole('button',{name:'分享审核',exact:true}).waitFor();
  assert.equal(await detail(page).getByRole('button',{name:'打开分支',exact:true}).count(),0);
  await page.screenshot({path:out+'/candidate-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'版本协作',exact:true}).click();
  await page.locator('.kb-branches .kb-graph').waitFor();
  assert.equal(await page.locator('.kb-branch-box select').inputValue(),publicReview.branch_id);
  assert.equal(new URL(page.url()).searchParams.get('tab'),'branches');
  await page.getByRole('button',{name:'返回普通视图',exact:true}).click();
  await detail(page).getByText(submitted.version.body,{exact:true}).waitFor();
  await approval(page).click();
  await detail(page).getByText(/我已同意 · 1 \/ 3 人同意/).waitFor();
  const completed=group(page,'其他待认可');
  await completed.locator('.kb-entry').filter({hasText:submitted.version.title}).waitFor();
  const headings=await page.locator('.kb-todo-group > h2').allTextContents();
  assert.deepEqual(headings,['我需认可','我的草稿','其他待认可']);

  const otherContext=await memberContext(browser,f,reader.actor,base);
  try {
    const other=await otherContext.newPage();
    await other.goto(workbench);
    await entry(other,foreign.version.title).waitFor();
    assert.equal(await entry(other,draft.version.title).count(),0);
    const privateRead=await otherContext.request.get(base+'/api/knowledge-workspace/documents/'+draft.document.id+'?branch_id='+draft.branch.id);
    assert.ok([403,404].includes(privateRead.status()),'direct private document request is rejected');
    await other.goto(candidateUrl(publicReview));
    await detail(other).getByText(submitted.version.body,{exact:true}).waitFor();
    await approval(other).click();
    await detail(other).getByText(/我已同意 · 2 \/ 3 人同意/).waitFor();
  } finally {
    await otherContext.close();
  }
  await third.approve({id:publicReview.id,head_id:publicReview.head_id,request_id:request()});
  await page.goto(candidateUrl(publicReview));
  await detail(page).getByText(/已入库 · 3 \/ 3 人同意/).waitFor();
  assert.equal(await approval(page).count(),0);
  await detail(page).getByRole('button',{name:'查看已入库文档'}).click();
  await page.locator('.kb-article-title').getByRole('heading',{name:submitted.version.title}).waitFor();

  for (const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    await page.goto(workbench);
    await entry(page,ending.version.title).waitFor();
    assert.ok(await viewportFits(page));
    await page.screenshot({path:out+'/todo-mobile-'+width+'.png',fullPage:true});
    await entry(page,ending.version.title).click();
    await detail(page).getByText(ending.version.body,{exact:true}).waitFor();
    await approval(page).scrollIntoViewIfNeeded();
    const button=await approval(page).boundingBox();
    assert.ok(button.height>=44 && button.x>=0 && button.x+button.width<=width && button.y+button.height<=844);
    assert.ok(await viewportFits(page));
    await page.screenshot({path:out+'/candidate-mobile-'+width+'.png',fullPage:true});
    await page.getByRole('button',{name:'← 文档',exact:true}).click();
    await entry(page,ending.version.title).waitFor();
  }
  await page.setViewportSize(screen);

  f.k.sqlite.prepare('UPDATE kw_merges SET expires_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),endingReview.id);
  await page.goto(candidateUrl(endingReview));
  await detail(page).getByText(/审核已过期.*投票已截止/).waitFor();
  assert.equal(await approval(page).count(),0);
  await group(page,'我的草稿').locator('.kb-entry').filter({hasText:ending.version.title}).click();
  assert.equal(await page.getByRole('button',{name:'分享文档',exact:true}).count(),0);
  await page.getByRole('button',{name:'提交到审核',exact:true}).click();
  await page.getByRole('dialog',{name:'提交到审核'}).getByRole('button',{name:'公开并提交审核'}).click();
  await detail(page).getByText(/我需认可 · 0 \/ 3 人同意/).waitFor();
  const newReview=new URL(page.url()).searchParams.get('review');
  assert.notEqual(newReview,endingReview.id);
  assert.equal((await writer.mergeRequest(newReview)).approval_count,0);

  const deleteBranch=await writer.createBranch({name:'拟移除已入库文档',visibility:'members',request_id:request()});
  const removed=await writer.remove({branch_id:deleteBranch.id,expected_version:deleteBranch.version,document_id:submitted.document.id,message:'拟移除已入库文档',request_id:request()});
  const removedVersion=(await writer.diff(deleteBranch.id)).changes[0].proposed;
  const removalReview=await writer.submitReview({branch_id:deleteBranch.id,expected_version:removed.version,document_id:submitted.document.id,version_id:removedVersion.id,reason:'审阅被移除的内容',request_id:request()});
  await page.goto(candidateUrl(removalReview));
  await detail(page).getByText('拟移除的文档',{exact:true}).waitFor();
  await detail(page).getByText(submitted.version.body,{exact:true}).waitFor();
  assert.equal(await detail(page).locator('.kb-diff-columns').count(),0);
  await approval(page).waitFor();
  await page.screenshot({path:out+'/removal-candidate-desktop.png',fullPage:true});
  await writer.deleteBranch({branch_id:removalReview.branch_id,expected_version:(await writer.branch(removalReview.branch_id)).version,request_id:request()});

  const stale=await saveDraft(writer,'版本已调整的候选','分享链接发出时的正文。','组织','members');
  const oldProposal=await writer.propose({branch_id:stale.branch.id,expected_version:stale.document.version,title:stale.version.title,reason:'原来提交的版本',request_id:request()});
  const edited=await writer.save({branch_id:stale.branch.id,expected_version:stale.document.version,document_id:stale.document.id,title:stale.version.title,body:'当前审核版本是这段新内容。',category:'组织',message:'修改待审版本',request_id:request()});
  await writer.propose({branch_id:stale.branch.id,expected_version:edited.version,title:stale.version.title,reason:'更新后的版本',request_id:request()});
  await page.goto(candidateUrl(oldProposal));
  await detail(page).getByText('此链接所指的版本已经更新。',{exact:true}).waitFor();
  assert.equal(await approval(page).count(),0);
  await detail(page).getByRole('button',{name:'查看当前审核',exact:true}).click();
  await detail(page).getByText('当前审核版本是这段新内容。',{exact:true}).waitFor();
  await approval(page).waitFor();

  const legacy=await saveDraft(writer,'旧批次第一篇','旧版本的单篇验收内容。','组织','members');
  await writer.save({branch_id:legacy.branch.id,expected_version:legacy.document.version,title:'旧批次另一篇',body:'本次保留在旧分支。',category:'知性',message:'建立旧版本多篇快照',request_id:request()});
  const legacyId=request(),legacyBranch=await writer.branch(legacy.branch.id),at=new Date().toISOString();
  f.k.sqlite.prepare('INSERT INTO kw_merges(id,branch_id,head_id,title,reason,author_id,author_name,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(legacyId,legacyBranch.id,legacyBranch.head_id,'旧批次验收','续办旧审核',writer.actor.id,writer.actor.name,at,at,new Date(Date.now()-1000).toISOString());
  await page.goto(workbench+'?'+new URLSearchParams({mode:'git',tab:'branches',branch:legacyBranch.id}));
  await page.getByRole('button',{name:'查看逐篇审核',exact:true}).click();
  await detail(page).getByText('这项旧审核包含多篇文档。请逐篇重新提交审核。',{exact:true}).waitFor();
  assert.equal(await approval(page).count(),0);
  await page.screenshot({path:out+'/legacy-review-desktop.png',fullPage:true});
  await detail(page).locator('.kb-diff').filter({hasText:legacy.version.title}).getByRole('button',{name:'单独提交这篇文档'}).click();
  await approval(page).waitFor();
  const resubmitted=await writer.mergeRequest(new URL(page.url()).searchParams.get('review'));
  assert.deepEqual(resubmitted.changes.map(change=>change.document_id),[legacy.document.id]);
  assert.equal(resubmitted.approval_count,0);
  await page.goto(documentUrl);
  return {defaultTodo:true,order:true,independentDeadline:true,twoMemberSessions:true,privateDrafts:true,openedCandidate:true,versionEntry:true,deletionPreview:true,voted:true,adopted:true,expired:true,staleShare:true,legacySingleDocument:true,mobile390:true,mobile320:true};
}
