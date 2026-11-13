import assert from 'node:assert/strict';
import {request} from '../knowledge/tests/fixture.mjs';

export async function verifyKnowledgeBranchDeletion(page,out,writer,documentUrl){
 const base=new URL(documentUrl).origin,mainBefore=await writer.branch('main');
 for(const mobile of [false,true]){
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1080});
  const branch=await writer.createBranch({name:mobile?'手机可删除分支':'桌面可删除分支',visibility:'private',request_id:request()});
  const doc=await writer.save({branch_id:branch.id,expected_version:branch.version,title:'待删除分支的草稿',body:'用于验证删除的独立虚构草稿。',category:'工程',message:'创建验收草稿',request_id:request()});
  await page.goto(base+'/knowledge?mode=git&branch='+branch.id+'&document='+doc.id);
  await page.locator('.kb-content-tabs').getByRole('button',{name:'分支',exact:true}).click();
  await page.getByRole('button',{name:'删除分支',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'删除分支',exact:true});
  await dialog.getByText('确认删除“'+(mobile?'手机可删除分支':'桌面可删除分支')+'”？',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:out+'/delete-branch-'+(mobile?'mobile':'desktop')+'.png',fullPage:true});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal((await writer.branch(branch.id)).state,'open');
  await page.getByRole('button',{name:'删除分支',exact:true}).click();
  let lost=false;
  if(!mobile)await page.route('**/api/knowledge-workspace/branches/delete',async route=>{if(!lost&&route.request().method()==='POST'){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await dialog.getByRole('button',{name:'确认删除',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  if(!mobile){await page.unroute('**/api/knowledge-workspace/branches/delete');assert.equal(lost,true);}
  await page.locator('.kb-branch-choices button.active').filter({hasText:'主分支'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'删除分支',exact:true}).count(),0);
  assert.equal((await writer.branches()).branches.some(b=>b.id===branch.id),false);
  if(mobile)await page.getByRole('button',{name:'← 条目',exact:true}).click();
  assert.equal(await page.locator('.kb-branch-box select').inputValue(),'main');
  assert.equal(await page.locator('.kb-branch-box option[value="'+branch.id+'"]').count(),0);
  await page.reload();await page.locator('.kb-branch-box option[value="main"]').waitFor({state:'attached'});
  assert.equal(await page.locator('.kb-branch-box option[value="'+branch.id+'"]').count(),0);
 }
 assert.deepEqual(await writer.branch('main'),mainBefore);
 await page.setViewportSize({width:1440,height:1080});await page.goto(documentUrl);
 return {desktop:true,mobile:true,cancel:true,lostResponse:true,mainProtected:true,persisted:true};
}

export async function verifyEmptyKnowledgeChrome(page,out,documentUrl){
 const url=new URL(documentUrl);url.search='?scope=drafts&mode=git';
 await page.goto(url.href);await page.locator('.kb-empty').waitFor();
 assert.equal(await page.locator('.kb-breadcrumb').count(),0);
 assert.equal(await page.getByRole('button',{name:'查看议题',exact:true}).count(),0);
 assert.equal(await page.locator('.kb-branch-extra').count(),0);
 assert.equal(await page.locator('.kb-branch-box button').count(),0);
 assert.equal(await page.locator('.kb-branch-box option:checked').innerText(),'主分支');
 const geometry=await page.locator('.kb-detail-toolbar').evaluate(el=>{const box=el.getBoundingClientRect(),toggle=el.querySelector('.kb-view-switch').getBoundingClientRect();return {gap:box.right-toggle.right};});
 assert.ok(Math.abs(geometry.gap)<2,'view switch stays at the right edge without breadcrumb');
 await page.screenshot({path:out+'/git-empty-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'简',exact:true}).click();
 await page.locator('.kb-breadcrumb').filter({hasText:'知识条目'}).waitFor();
 await page.getByRole('button',{name:'查看议题',exact:true}).waitFor();
 await page.goto(documentUrl);
 return {mainLabel:true,noExpand:true,noBreadcrumb:true,noDuplicateIssue:true,simpleUnchanged:true};
}
