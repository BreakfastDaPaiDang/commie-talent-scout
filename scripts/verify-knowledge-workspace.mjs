import {verifySharedTagCatalog} from './verify-shared-tag-catalog.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {createServer as createViteServer} from 'vite';
import {chromium} from 'playwright-core';
import {connectedFixture} from '../knowledge/tests/connected-fixture.mjs';
import {KnowledgeWorkspace} from '../knowledge/src/workspace.ts';
import {request} from '../knowledge/tests/fixture.mjs';
import personnel from '../app/server/index.ts';
import {verifyKnowledgeAnnotations,verifyGuestAnnotation} from './verify-knowledge-annotations.mjs';
import {verifyKnowledgeCategories,verifyKnowledgeDemo} from './verify-knowledge-categories.mjs';
import {verifyKnowledgeBranchDeletion,verifyEmptyKnowledgeChrome} from './verify-knowledge-branches.mjs';
import {verifyKnowledgeHelp,verifyReadOnlyKnowledgeHelp} from './verify-knowledge-help.mjs';
import {verifyKnowledgeReviewQueue} from './verify-knowledge-review.mjs';

const f=await connectedFixture(),base='http://127.0.0.1:8797',out='tmp/verification/knowledge-workspace';mkdirSync(out,{recursive:true});
const identity=(await f.call('/api/identity')).body,services=[identity,...f.k.actors.slice(1,3)].map(a=>new KnowledgeWorkspace(f.k.db,a));
const writer=services[0],titles=['审核应该了解什么','验证目标的理论能力','从实际作品展开追问','已知信息不必重复询问','资料整理需要校对协作'];
const body='从参与意愿、能力与投入、协作与支持三个方面，梳理审核需要重点了解的内容。\n\n## 参与意愿\n了解对方加入的动机与期望，确认其对组织定位与现状有基本认识。\n\n## 能力与投入\n结合过往经历或作品判断实际水平。了解可以投入的时间与精力。\n\n## 协作与支持\n了解沟通方式与协作习惯，以及所需的资源、工具和指导。';
for (const tag of ['知性','组织','工程']) {
 const created=await writer.editCategory({name:tag,definition:tag==='知性'?'理解经验，也包括解释行为。':'',request_id:request()});
 for(const service of services) await service.approveTag({id:created.proposal_id,request_id:request()});
}
let first;
const documents=[];
for(const [i,title] of titles.entries()){
 const branch=await writer.createBranch({name:title,visibility:'private',request_id:request()});
 const doc=await writer.save({branch_id:branch.id,expected_version:branch.version,title,body:i?title+'的示例内容。':body,category:i===4?'组织':'知性',kind:i===4?'需求':i%2?'方法':'共识',message:'建立验收文档',request_id:request()});
 const version=await writer.document(branch.id,doc.id);
 const merge=await writer.submitReview({branch_id:branch.id,expected_version:doc.version,document_id:doc.id,version_id:version.id,reason:'虚构验收材料',request_id:request()});
 for(const service of services) await service.approve({id:merge.id,head_id:merge.head_id,request_id:request()});
 assert.equal((await writer.mergeRequest(merge.id)).state,'merged');
 documents.push(doc);
 if(!first) first=doc;
}
const root=resolve('dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
f.p.env.ASSETS={async fetch(req){const path=resolve(root,'.'+decodeURIComponent(new URL(req.url).pathname));if(path!==root&&!path.startsWith(root+sep))return new Response('',{status:403});const file=existsSync(path)&&extname(path)?path:resolve(root,'index.html');return new Response(readFileSync(file),{headers:{'Content-Type':mime[extname(file)]??'application/octet-stream'}});}};
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),response=await personnel.fetch(new Request(base+req.url,{method:req.method,headers:req.headers,...(bytes.length?{body:bytes}:{})}),f.p.env,f.ctx);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(8797,'127.0.0.1',r));
const preview=await createViteServer({configFile:false,root:resolve('prototypes/frontend'),cacheDir:resolve('tmp/knowledge-verification-vite'),publicDir:resolve('public'),resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:5197,strictPort:true,fs:{allow:[resolve('.')]},proxy:{'/api':{target:base,changeOrigin:true}}}});await preview.listen();
const browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER==='chrome'?'chrome':'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1080}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await context.addCookies([{name:'cts_session',value:f.session,url:base}]);
const documentUrl=base+'/knowledge?scope=main&document='+first.id;
async function fitted(){const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,workspace:document.querySelector('.kb-workspace')?.getBoundingClientRect().width}));assert.ok(sizes.scroll<=sizes.width+1,JSON.stringify(sizes));}
async function selectSentence(){await page.locator('.kb-body [data-kb-start]').filter({hasText:'结合过往经历或作品判断实际水平。'}).scrollIntoViewIfNeeded();await page.evaluate(()=>{const sentence='结合过往经历或作品判断实际水平。',span=[...document.querySelectorAll('.kb-body [data-kb-start]')].find(n=>n.textContent.includes(sentence)),walker=document.createTreeWalker(span,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const at=node.textContent.indexOf(sentence);if(at>=0){const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+sentence.length);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);break;}}});await page.getByRole('toolbar',{name:'选中文字操作'}).waitFor();}

async function verifyKnowledgeAgentEntry(){
 const handoff=page.locator('.agent-page .agent-simple');
 const agentHeading=handoff.getByRole('heading',{name:/如果你被难住了/});
 const steps=handoff.locator('.agent-connect-steps li');
 const article=page.locator('.kb-article-title').getByRole('heading',{name:titles[0],exact:true});
 await page.goto(base+'/agent');
 await agentHeading.waitFor();
 const expectedSteps=await steps.allTextContents();
 assert.equal(expectedSteps.length,3);
 for(const width of [1440,390,320]){
  const mobile=width<700;
  await page.setViewportSize({width,height:mobile?844:1080});
  await page.goto(documentUrl);
  await article.waitFor();
  if(mobile)await page.getByRole('button',{name:'打开工具导航',exact:true}).click();
  const tools=page.locator(mobile?'.mobile-menu':'.topbar-tools');
  await tools.getByRole('button',{name:'Agent 接入',exact:true}).click();
  await page.waitForURL(url=>url.pathname==='/agent');
  await agentHeading.waitFor();
  await handoff.getByRole('button',{name:'复制提示词给 Agent',exact:true}).waitFor();
  assert.deepEqual(await steps.allTextContents(),expectedSteps);
  await fitted();
  await page.goBack();
  await article.waitFor();
  assert.equal(new URL(page.url()).searchParams.get('document'),first.id);
 }
 await page.setViewportSize({width:1440,height:1080});
 return {desktop:true,mobile390:true,mobile320:true};
}

const report={desktop:false,mobile:false,prototype:false,comments:false,annotation:false,merge:false,multipleCandidates:false,catalog:false,gift:false,night:false,category:false,errors};
try{
 await page.goto(documentUrl);await page.getByRole('heading',{name:titles[0],exact:true}).last().waitFor();await fitted();assert.equal(await page.locator('.kb-branch-box').count(),0);assert.equal(await page.getByRole('button',{name:'已入库',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.kb-category-drawer').count(),0);
 await page.screenshot({path:out+'/simple-desktop.png',fullPage:true});report.tutorial=await verifyKnowledgeHelp(page,out,documentUrl);
 await page.getByLabel('写下对这篇文档的评论…').fill('文末讨论：建议补充一个审核实例。');let dropped=false;await page.route('**/api/knowledge-workspace/comments',async route=>{if(route.request().method()==='POST'&&!dropped){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});await page.locator('.kb-document-comments').getByRole('button',{name:'发送',exact:true}).click();await page.getByText('文末讨论：建议补充一个审核实例。',{exact:true}).waitFor();await page.unroute('**/api/knowledge-workspace/comments');assert.equal(f.k.sqlite.prepare('SELECT COUNT(*) n FROM kw_comments WHERE body=?').get('文末讨论：建议补充一个审核实例。').n,1);report.comments=true;
 await selectSentence();await page.getByRole('toolbar').getByRole('button',{name:'批注',exact:true}).click();await page.getByLabel('针对这句话写下批注…').fill('可引用实际作品，不能只看自述。');await page.screenshot({path:out+'/annotation-editor-desktop.png',fullPage:true});await page.getByRole('button',{name:'发布批注',exact:true}).click();await page.getByText('可引用实际作品，不能只看自述。',{exact:true}).waitFor();const placement=await page.locator('.kb-inline-thread').evaluate(el=>({before:el.previousElementSibling.textContent,after:el.nextElementSibling.textContent}));assert.match(placement.before,/结合过往经历/);assert.match(placement.after,/了解可以投入/);report.annotation=await verifyKnowledgeAnnotations(page,out);assert.equal((await writer.document('main',first.id)).body,body);
 report.category=await verifyKnowledgeCategories(page,out,services,documentUrl);
 await page.getByRole('button',{name:'版本协作',exact:true}).click();await page.locator('.kb-branch-box').waitFor();assert.equal(await page.locator('.kb-graph').count(),0);const position=await page.evaluate(()=>({header:document.querySelector('.kb-list-head').getBoundingClientRect().bottom,branch:document.querySelector('.kb-branch-box').getBoundingClientRect().top,categories:document.querySelector('.kb-list-filters').getBoundingClientRect().top}));assert.ok(position.branch>=position.header&&position.branch<position.categories);assert.equal(await page.locator('.kb-branch-box option:checked').innerText(),'主分支');assert.equal(await page.locator('.kb-branch-box button').count(),0);assert.equal(await page.locator('.kb-document-tags').count(),0);await page.screenshot({path:out+'/git-desktop.png',fullPage:true});report.desktop=true;report.simplifiedChrome=await verifyEmptyKnowledgeChrome(page,out,documentUrl);await page.getByRole('button',{name:'版本协作',exact:true}).click();
 const geometry=await page.locator('.kb-list-pane').boundingBox();const previewPage=await context.newPage();await previewPage.goto('http://127.0.0.1:5197/?knowledge&connected&mode=git&document='+first.id);await previewPage.getByRole('heading',{name:titles[0],exact:true}).last().waitFor().catch(async error=>{
   console.error('Connected prototype:',previewPage.url(),(await previewPage.locator('body').innerText()).slice(0,1400));
   throw error;
 });const previewGeometry=await previewPage.locator('.kb-list-pane').boundingBox();assert.ok(Math.abs(geometry.width-previewGeometry.width)<1);await previewPage.screenshot({path:out+'/shared-prototype.png',fullPage:true});await verifyKnowledgeDemo(previewPage,out);await previewPage.close();report.prototype=true;
 await page.getByRole('button',{name:'返回普通视图',exact:true}).click();await page.getByRole('button',{name:'建议修改',exact:true}).click();const edit=page.getByRole('dialog',{name:'修改文档'});await edit.getByLabel('正文',{exact:true}).fill(body.replace('结合过往经历或作品判断实际水平。','通过可核对的作品与合作记录形成判断。'));await edit.getByLabel('修改说明',{exact:true}).fill('增加可核对的证据要求');await page.screenshot({path:out+'/editor-desktop.png',fullPage:true});await edit.getByRole('button',{name:'保存草稿',exact:true}).click();await edit.waitFor({state:'detached'});const submit=page.getByRole('button',{name:'提交到审核',exact:true});await submit.waitFor();const submitBox=await submit.boundingBox();assert.ok(submitBox.width>=70&&submitBox.height>=36&&submitBox.x>=0&&submitBox.x+submitBox.width<=1440&&submitBox.y+submitBox.height<=1080);await page.screenshot({path:out+'/draft-submit-desktop.png',fullPage:true});await submit.click();const review=page.getByRole('dialog',{name:'提交到审核',exact:true});await page.screenshot({path:out+'/review-preview-desktop.png',fullPage:true});await review.getByRole('button',{name:'公开并提交审核'}).click();await review.waitFor({state:'detached'});
 const comparison=page.locator('.kb-review-detail .kb-diff-columns');
 await comparison.locator('.kb-line-added').filter({hasText:'通过可核对的作品与合作记录形成判断。'}).waitFor();
 await comparison.locator('.kb-line-removed').filter({hasText:'结合过往经历或作品判断实际水平。'}).waitFor();
 await page.locator('.kb-review-ballot time').filter({hasText:/^剩 7 天$/}).waitFor();
 await page.locator('.kb-detail-scroll').evaluate(el=>el.scrollTop=0);
 await page.screenshot({path:out+'/revision-comparison-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'认可此版本',exact:true}).click();await page.locator('.kb-review-ballot').getByLabel('1 / 3 人认可',{exact:true}).waitFor();await page.locator('.kb-review-ballot').getByText('我已认可',{exact:true}).waitFor();
 const open=(await writer.mergeRequests()).merges.find(m=>m.state==='open');for(const s of services.slice(1))await s.approve({id:open.id,head_id:open.head_id,request_id:request()});assert.equal((await writer.mergeRequest(open.id)).state,'merged');await page.goto(documentUrl);await page.getByText('原文已变更的批注（3）',{exact:true}).waitFor();report.merge=true;

 report.reviewQueue=await verifyKnowledgeReviewQueue(page,browser,out,f,services,documentUrl);
 const candidates=[];
 for(const name of ['候选甲','候选乙']){const b=await writer.createBranch({name,request_id:request()}),d=await writer.save({branch_id:b.id,expected_version:b.version,document_id:documents[2].id,title:name,body:name+'需要集体选择的方案。',category:'工程',message:'候选方案',request_id:request()}),m=await writer.propose({branch_id:b.id,expected_version:d.version,title:name,reason:'讨论后选择',request_id:request()});for(const s of services)await s.approve({id:m.id,head_id:m.head_id,request_id:request()});candidates.push({...m,branch_id:b.id});}
 await page.goto(documentUrl+'&mode=git&branch='+candidates[0].branch_id);await page.getByRole('button',{name:'分支',exact:true}).click();await page.getByText(/有 2 个候选达到三人同意/).waitFor();await page.getByRole('button',{name:'合入主分支',exact:true}).click();const choice=page.getByRole('dialog',{name:'合入主分支'});await choice.locator('textarea[name=notes]').fill('会议时间、参与者与结论可以在此记录。');await page.screenshot({path:out+'/candidate-meeting-desktop.png',fullPage:true});await choice.getByRole('button',{name:'关闭对话框'}).click();
 await page.locator('.kb-content-tabs').getByRole('button',{name:'议题',exact:true}).click();await page.getByRole('button',{name:'＋ 新议题',exact:true}).click();const issueForm=page.getByRole('dialog',{name:'新议题'});await issueForm.locator('[name=title]').fill('选择共识方案');await issueForm.locator('[name=body]').fill('比较甲乙，记录共同选择。');await issueForm.getByRole('button',{name:'提交议题'}).click();await issueForm.waitFor({state:'detached'});await page.getByRole('button',{name:'记录结论'}).click();const conclusion=page.getByRole('dialog',{name:'记录议题结论'});await conclusion.locator('[name=resolution]').fill('集体讨论后选择候选甲，乙继续保留。');await conclusion.locator('[name=merge]').selectOption(candidates[0].id);await conclusion.getByRole('button',{name:'保存结论'}).click();await conclusion.waitFor({state:'detached'});
 await page.getByRole('button',{name:'分支',exact:true}).click();await page.getByRole('button',{name:'合入主分支',exact:true}).click();await choice.getByRole('combobox').first().selectOption('issue');await choice.locator('[name=issue]').selectOption((await writer.issues()).issues.find(i=>i.title==='选择共识方案').id);await page.screenshot({path:out+'/candidate-issue-desktop.png',fullPage:true});await choice.getByRole('button',{name:'确认合入'}).click();await choice.waitFor({state:'detached'});assert.equal((await writer.mergeRequest(candidates[0].id)).state,'merged');assert.equal((await writer.mergeRequest(candidates[1].id)).state,'open');report.multipleCandidates=true;
 await page.goto(documentUrl+'&mode=git');await page.getByRole('button',{name:'切换到深夜模式'}).click();await page.screenshot({path:out+'/git-night.png',fullPage:true});const night=await page.locator('.kb-entry.selected').evaluate(e=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}));assert.equal(night.background,'rgb(57, 54, 46)');assert.equal(await page.locator('.kb-tag-filter').evaluate(e=>getComputedStyle(e).backgroundImage),'none');await page.getByRole('button',{name:'切换到日间模式'}).click();report.night=true;
 await page.setViewportSize({width:390,height:844});await page.goto(documentUrl);await page.getByRole('heading',{name:titles[0],exact:true}).last().waitFor();await fitted();await page.screenshot({path:out+'/simple-mobile.png',fullPage:true});await page.getByLabel('写下对这篇文档的评论…').fill('手机端评论');await page.locator('.kb-document-comments').getByRole('button',{name:'发送',exact:true}).click();await page.getByText('手机端评论',{exact:true}).waitFor();await page.getByRole('button',{name:'建议修改',exact:true}).click();const mobileEdit=page.getByRole('dialog',{name:'修改文档'});await mobileEdit.getByLabel('修改说明',{exact:true}).fill('手机端补充测试');await mobileEdit.getByLabel('正文',{exact:true}).fill(body+'\n手机端完整编辑。');await mobileEdit.getByRole('button',{name:'保存草稿',exact:true}).scrollIntoViewIfNeeded();await fitted();await page.screenshot({path:out+'/editor-mobile.png',fullPage:true});await mobileEdit.getByRole('button',{name:'保存草稿',exact:true}).click();await mobileEdit.waitFor({state:'detached'});const mobileSubmit=page.getByRole('button',{name:'提交到审核',exact:true});await mobileSubmit.waitFor();const mobileSubmitBox=await mobileSubmit.boundingBox();assert.ok(mobileSubmitBox.width>330&&mobileSubmitBox.y+mobileSubmitBox.height<=844);await page.screenshot({path:out+'/draft-submit-mobile.png',fullPage:true});await mobileSubmit.click();const mobileReview=page.getByRole('dialog',{name:'提交到审核',exact:true});await mobileReview.getByRole('button',{name:'公开并提交审核'}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/review-preview-mobile.png',fullPage:true});await mobileReview.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'← 文档',exact:true}).click();await page.getByRole('button',{name:'标签筛选',exact:true}).click();const mobileFilter=page.getByRole('dialog',{name:'标签筛选',exact:true});await mobileFilter.getByLabel('查找已有词义').fill('知性');await mobileFilter.locator('.tag-choice-list article').filter({hasText:'知性'}).getByRole('button',{name:'查看与维护'}).click();await page.getByRole('dialog',{name:'知性标签定义与留言'}).waitFor();await page.screenshot({path:out+'/category-drawer-mobile.png',fullPage:true});await page.getByRole('button',{name:'关闭标签侧栏'}).click();report.mobile=true;report.branchDeletion=await verifyKnowledgeBranchDeletion(page,out,writer,documentUrl);

 await page.setViewportSize({width:1440,height:1080});await page.goto(base+'/tools/resources');await page.getByRole('heading',{name:'生产资源库',exact:true}).waitFor();await page.getByRole('button',{name:'＋ 发布资源',exact:true}).click();const resource=page.getByRole('dialog',{name:'发布资源入口'});await resource.getByLabel('资源名称',{exact:true}).fill('验收资源');await resource.getByLabel('提供方',{exact:true}).fill('虚构工作组');await resource.getByLabel('获取条件').fill('由负责人点对点接收');await resource.getByLabel('联系入口').fill('联系本次验收的虚构负责人');await resource.getByRole('button',{name:'发布',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/resource-editor-desktop.png',fullPage:true});await resource.getByRole('button',{name:'发布',exact:true}).click();await resource.waitFor({state:'detached'});await page.getByRole('dialog',{name:'验收资源'}).waitFor();assert.equal(f.k.sqlite.prepare('SELECT COUNT(*) n FROM catalog_entries').get().n,1);assert.equal(f.p.sqlite.prepare('SELECT COUNT(*) n FROM work_overview_resources').get().n,0);report.catalog=true;
 await page.getByRole('button',{name:'发放糖果入口'}).click();const giftForm=page.getByRole('dialog',{name:'发放糖果入口'});await giftForm.locator('[name=recipient]').fill('虚构接收者');await giftForm.locator('[name=body]').fill('负责人接收测试');await giftForm.getByRole('button',{name:'建立安排并生成入口'}).click();const giftLink=page.getByRole('dialog',{name:'糖果入口已生成'});const link=await giftLink.getByLabel('访问链接').inputValue();const guestContext=await browser.newContext({viewport:{width:390,height:844}}),guestPage=await guestContext.newPage();await guestPage.goto(link);await guestPage.locator('.kb-entry').first().waitFor();await verifyReadOnlyKnowledgeHelp(guestPage);report.tutorial.readOnly=true;assert.equal(await guestPage.getByRole('button',{name:'＋ 新文档',exact:true}).count(),0);assert.equal((await guestContext.request.get(base+'/api/archives')).status(),401);assert.equal(await guestPage.evaluate(()=>location.hash),'');await guestPage.locator('.kb-entry').filter({hasText:titles[0]}).click();await verifyGuestAnnotation(guestPage);await guestPage.screenshot({path:out+'/gift-reader-mobile.png',fullPage:true});await guestContext.close();await giftLink.getByRole('button',{name:'关闭对话框'}).click();await page.getByRole('dialog',{name:'验收资源'}).getByRole('button',{name:'关闭对话框'}).click();await page.getByRole('button',{name:'接收安排',exact:true}).click();await page.getByRole('button',{name:'确认接收',exact:true}).click();const receiving=page.getByRole('dialog',{name:'确认接收'});await receiving.locator('[name=body]').fill('已由指定负责人建立联系');await receiving.getByRole('button',{name:'确认接收',exact:true}).click();await receiving.waitFor({state:'detached'});assert.equal(f.k.sqlite.prepare('SELECT state FROM catalog_grants').get().state,'received');report.gift=true;
 report.sharedTagCatalog=await verifySharedTagCatalog(page,out,writer,documentUrl);
 await page.setViewportSize({width:1440,height:1080});await page.goto(documentUrl);await page.locator('.kb-article-title').waitFor();
 await page.getByRole('button',{name:'标签筛选',exact:true}).click();
 const beforeFilter=(await writer.list({scope:'main'})).documents.length;
 const filter=page.getByRole('dialog',{name:'标签筛选',exact:true});
 await filter.getByLabel('查找已有词义').fill('组织');
 await filter.locator('.tag-choice-list article').filter({hasText:'组织'}).getByRole('button',{name:'选择',exact:true}).click();
 await page.locator('.kb-entry').filter({hasText:titles[4]}).waitFor();
 await page.waitForFunction(()=>{
   const selected=document.querySelector('.kb-entry[aria-current="true"] .kb-index-title')?.textContent;
   return !!selected && document.querySelector('.kb-article-title h1')?.textContent===selected;
 });
 await page.locator('.kb-entry').filter({hasText:titles[4]}).click();
 await page.locator('.kb-article-title').getByRole('heading',{name:titles[4]}).waitFor();
 assert.equal(await page.locator('.kb-breadcrumb,.kb-entry-kind').count(),0);
 await page.getByRole('button',{name:'清除标签筛选'}).click();
 await page.waitForFunction(count=>document.querySelectorAll('.kb-entry').length===count,beforeFilter);
 await page.getByRole('button',{name:'＋ 新文档',exact:true}).first().click();const flatEditor=page.getByRole('dialog',{name:'新文档',exact:true});
 assert.equal(await flatEditor.getByLabel('文档类型',{exact:true}).count(),0);assert.equal(await flatEditor.locator('.tag-chip').count(),0);
 assert.doesNotMatch(await flatEditor.innerText(),/分类|条目/);await page.screenshot({path:out+'/flat-editor-desktop.png',fullPage:true});await page.keyboard.press('Escape');
 report.flatTags={noBreadcrumb:true,noKind:true,explicitTag:true,filterChangesDetail:true,clearRestoresList:true,nestedEditor:true};
 report.agentEntry=await verifyKnowledgeAgentEntry();
 assert.deepEqual(errors,[]);writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});writeFileSync(out+'/failure.txt',String(error)+'\n'+JSON.stringify(errors));throw error;}
finally{await browser.close();await preview.close();await new Promise(r=>server.close(r));await f.close();}
