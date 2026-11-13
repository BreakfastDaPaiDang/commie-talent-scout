import assert from 'node:assert/strict';

// Existing personnel tags and independent knowledge categories use the same UI,
// with real HTTP persistence and no cross-library writes.
export async function verifySharedTagCatalog(page,out,writer,documentUrl){
 const original=(await writer.list({})).documents.find(d=>documentUrl.includes(d.document_id));
 assert.ok(original);
 const before=(await writer.categories()).categories.length;
 await page.goto(documentUrl);
 await page.getByRole('button',{name:'建议修改',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'修改文档',exact:true}),title=await editor.getByLabel('标题',{exact:true}).inputValue(),body=await editor.getByLabel('正文',{exact:true}).inputValue();
 await editor.getByRole('button',{name:'分类',exact:true}).click();
 const chooser=page.getByRole('dialog',{name:'分类标签',exact:true});
 await chooser.getByLabel('查找已有词义').fill('协作方法');
 await chooser.locator('.tag-choice-list article').filter({hasText:'协作方法'}).getByRole('button',{name:'选择',exact:true}).click();
 assert.equal(await editor.getByLabel('标题',{exact:true}).inputValue(),title);
 assert.equal(await editor.getByLabel('正文',{exact:true}).inputValue(),body);
 await editor.getByRole('button',{name:'分类',exact:true}).filter({hasText:'协作方法'}).waitFor();
 await editor.getByLabel('修改说明',{exact:true}).fill('复用已有分类，不创建重复词条');
 await page.screenshot({path:out+'/shared-tags-document-editor.png',fullPage:true});
 await editor.getByRole('button',{name:'保存草稿',exact:true}).click();await editor.waitFor({state:'detached'});
 await page.getByRole('button',{name:'提交到审核',exact:true}).waitFor();await page.reload();
 await page.locator('.kb-breadcrumb').filter({hasText:'协作方法'}).waitFor();
 const current=new URL(page.url()),saved=await writer.document(current.searchParams.get('branch'),original.document_id);
 assert.equal(saved.category_name,'协作方法');assert.equal(saved.title,title);assert.equal(saved.body,body);
 assert.equal((await writer.categories()).categories.length,before);

 const base=new URL(documentUrl).origin,name='共享标签组件验收';
 await page.goto(base+'/tags');
 await page.getByLabel('查找已有词义').fill(name);
 await page.getByText('没有找到适用词条，可在下方新建。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'没有适用词义？新建标签',exact:true}).click();
 const form=page.locator('.tag-create-form');await form.locator('select').selectOption('new');await form.getByLabel('类别名称',{exact:true}).fill('共享类别验收');
 await form.getByLabel('标签名称',{exact:true}).fill(name);await form.getByLabel('词义说明',{exact:true}).fill('只用于隔离测试，核对既有人物标签仍可创建和复用。');
 await page.screenshot({path:out+'/shared-tags-personnel-create.png',fullPage:true});
 await form.getByRole('button',{name:'保存词条',exact:true}).click();await form.waitFor({state:'detached'});
 const row=page.locator('.tag-choice-list article').filter({hasText:name});await row.waitFor();
 await page.reload();await page.getByLabel('查找已有词义').fill(name);await row.waitFor();
 assert.equal(await row.count(),1);await row.getByRole('button',{name:'查看与维护',exact:true}).click();
 await page.getByRole('dialog',{name:'共享类别验收：'+name,exact:true}).waitFor();
 const response=await page.request.get(base+'/api/tags?'+new URLSearchParams({type:'person',query:name}));assert.equal(response.status(),200);assert.equal((await response.json()).tags.length,1);
 assert.equal((await writer.categories()).categories.some(c=>c.name===name),false,'personnel tags stay in the personnel library');
 await page.goto(documentUrl);
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'← 条目',exact:true}).click();await page.getByRole('button',{name:'添加分类',exact:true}).click();
  await chooser.getByLabel('查找已有词义').fill('窄屏分类验收');await chooser.getByRole('button',{name:'没有适用词义？新建分类',exact:true}).click();await chooser.getByLabel('分类解释').fill('完整显示可编辑字段和提交按钮，保留原库边界。');
  await chooser.getByRole('button',{name:'创建分类',exact:true}).scrollIntoViewIfNeeded();assert.equal(await chooser.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
  const button=await chooser.getByRole('button',{name:'创建分类',exact:true}).boundingBox();assert.ok(button.x>=0&&button.x+button.width<=width&&button.y+button.height<=844);
  await page.screenshot({path:out+'/shared-tags-category-'+width+'.png',fullPage:true});
  await chooser.getByRole('button',{name:'返回查找',exact:true}).click();assert.equal(await chooser.getByLabel('查找已有词义').inputValue(),'窄屏分类验收');
  await page.keyboard.press('Escape');await page.goto(documentUrl);
 }
 await page.setViewportSize({width:1440,height:1080});await page.goto(documentUrl);
 return {documentSelection:true,persisted:true,personnelCreation:true,libraryIsolation:true,narrowForm:true};
}
