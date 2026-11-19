import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {createServer as createViteServer} from 'vite';
import {pdfAssets} from './lib/pdf-assets.mjs';
import {chromium} from 'playwright-core';
import {connectedFixture} from '../knowledge/tests/connected-fixture.mjs';
import {KnowledgeWorkspace} from '../knowledge/src/workspace.ts';
import {request} from '../knowledge/tests/fixture.mjs';
import personnel from '../app/server/index.ts';

const f=await connectedFixture(),base='http://127.0.0.1:8798',out='tmp/verification/whale-home-live';mkdirSync(out,{recursive:true});
const identity=(await f.call('/api/identity')).body,services=[identity,...f.k.actors.slice(1,3)].map(a=>new KnowledgeWorkspace(f.k.db,a));
const writer=services[0],titles=['审核应该了解什么','验证目标的理论能力','从实际作品展开追问','已知信息不必重复询问','资料整理需要校对协作'];
const body='从参与意愿、能力与投入、协作与支持三个方面，梳理审核需要重点了解的内容。\n\n## 参与意愿\n了解对方加入的动机与期望，确认其对组织定位与现状有基本认识。\n\n## 能力与投入\n结合过往经历或作品判断实际水平。了解可以投入的时间与精力。\n\n## 协作与支持\n了解沟通方式与协作习惯，以及所需的资源、工具和指导。';
const branch=await writer.createBranch({name:'初始共识',visibility:'private',request_id:request()});
let branchVersion=branch.version;
for(const [i,title] of titles.entries()){
 const doc=await writer.save({
  branch_id:branch.id,expected_version:branchVersion,title,body:i?title+'的示例内容。':body,
  category:i===4?'组织':'知性',kind:i===4?'需求':i%2?'方法':'共识',message:'建立验收文档',request_id:request(),
 });
 branchVersion=doc.version;
 const review=await writer.submitReview({
  branch_id:branch.id,expected_version:branchVersion,document_id:doc.id,version_id:doc.version_id,
  reason:'虚构验收材料',request_id:request(),
 });
 for(const member of services) await member.approve({id:review.id,head_id:review.head_id,request_id:request()});
 assert.equal((await writer.mergeRequest(review.id)).state,'merged');
}
const root=resolve('dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
f.p.env.ASSETS={async fetch(req){const path=resolve(root,'.'+decodeURIComponent(new URL(req.url).pathname));if(path!==root&&!path.startsWith(root+sep))return new Response('',{status:403});const file=existsSync(path)&&extname(path)?path:resolve(root,'index.html');return new Response(readFileSync(file),{headers:{'Content-Type':mime[extname(file)]??'application/octet-stream'}});}};
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),response=await personnel.fetch(new Request(base+req.url,{method:req.method,headers:req.headers,...(bytes.length?{body:bytes}:{})}),f.p.env,f.ctx);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(8798,'127.0.0.1',r));
const preview=await createViteServer({configFile:false,plugins:[pdfAssets()],root:resolve('prototypes/frontend'),publicDir:resolve('public'),resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:5198,strictPort:true,fs:{allow:[resolve('.')]},proxy:{'/api':{target:base,changeOrigin:true}}}});await preview.listen();
const browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER==='chrome'?'chrome':'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1080}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await context.addCookies([{name:'cts_session',value:f.session,url:base}]);

async function api(path,body){
 const response=await context.request.post(base+'/api'+path,{headers:{Origin:base},data:{...body,request_id:request()}});
 const result=await response.json();assert.equal(response.status(),200,JSON.stringify(result));return result;
}
const subject=await api('/archives/create',{type:'person',name:'虚构对象特征验收'});
const category=await api('/tag-categories/create',{type:'person',name:'特征验收',color:'sage'}),tagIds=[];
for(let i=1;i<=7;i++)tagIds.push((await api('/tags/create',{category_id:category.id,name:'特征'+i,description:'虚构特征的通用说明'})).id);
await api('/archive-tags/update',{archive_id:subject.id,expected_version:subject.version??1,changes:tagIds.map(tag_id=>({tag_id,action:'add',evidence:[{kind:'member_instruction',note:'本次虚构验收明确提供的特征依据。'}]})),focus:[tagIds[6]]});
const todo=await api('/work-tasks/create',{archive_id:subject.id,kind:'custom',title:'验证默认任务',purpose:'检查打开网站后直接看到工作',delivery:'保存验收结果',deadline_at:'2099-01-01T00:00:00.000Z'});
const report=[];
try{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  for(const [name,path,selector] of [
   ['外部人物','/people','.archive-head'],['社员','/members','.archive-head'],['任务','/tasks','.task-workspace'],
   ['仪表盘','/statistics','.statistics-page'],['知识库','/knowledge','.kb-workspace'],['Agent 接入','/agent','.agent-simple']
  ]){
   await page.goto(base+'/home');await page.locator('.whale-entrance--blue').waitFor();
   await page.getByRole('link',{name,exact:true}).click();
   await page.waitForURL(url=>url.pathname===path);await page.locator(selector).first().waitFor();
   if(name==='外部人物')assert.equal(await page.locator('.archive-kind-switcher').count(),0);
   await page.locator('.topbar .brand').click();await page.locator('.task-workspace').waitFor();
   const navigation=page.getByRole('navigation',{name:'主要导航'});
   assert.deepEqual(await navigation.getByRole('button').allTextContents(),['外部人物','组织','任务','社员','统计','知识库']);
   assert.equal(await navigation.getByRole('button').nth(2).getAttribute('aria-current'),'page');
   report.push({width,name,path,realHttp:true,returnHome:true});
  }
  await page.goto(base+'/home');await page.locator('.whale-entrance img').evaluateAll(els=>Promise.all(els.map(el=>el.decode())));
  await page.screenshot({path:out+'/home-'+width+'.png',fullPage:true});
 }
 for(const width of [1440,390,320])for(const theme of ['light','night']){
  await page.setViewportSize({width,height:width<700?844:1000});
  await page.goto(base+'/');
  await page.evaluate(mode=>localStorage.setItem('cts-display-mode',mode),theme);await page.reload();
  await page.getByRole('heading',{name:'任务',exact:true}).waitFor();
  const navigation=page.getByRole('navigation',{name:'主要导航'});
  assert.deepEqual(await navigation.getByRole('button').allTextContents(),['外部人物','组织','任务','社员','统计','知识库']);
  assert.equal(await navigation.getByRole('button').nth(2).getAttribute('aria-current'),'page');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:out+'/navigation-'+width+'-'+theme+'.png',fullPage:true});
  report.push({width,theme,taskNavigationThird:true,taskHeading:true});
 }
 await page.evaluate(()=>localStorage.setItem('cts-display-mode','light'));
 for(const width of [1440,320]){
  await page.setViewportSize({width,height:width<700?844:1000});
  await page.goto('http://127.0.0.1:5198/?knowledge');await page.locator('.kb-workspace').waitFor();
  assert.deepEqual(await page.getByRole('navigation',{name:'主要导航'}).getByRole('button').allTextContents(),['外部人物','组织','任务','社员','统计','知识库']);
  await page.screenshot({path:out+'/knowledge-navigation-'+width+'.png',fullPage:true});
  report.push({width,prototypeTaskNavigationThird:true});
 }
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:width<700?844:1000});
  await page.goto(base+'/');await page.locator('.task-index-item').filter({hasText:'验证默认任务'}).waitFor();
  await page.getByRole('heading',{name:'任务',exact:true}).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'主要导航'}).getByRole('button').nth(2).innerText(),'任务');
  assert.equal(await page.getByRole('button',{name:'待办',exact:true}).count(),0);
  const listBox=await page.locator('.task-index-panel').boundingBox(),recommendationBox=await page.locator('.task-recommendation').boundingBox();
  assert.ok(listBox.y<recommendationBox.y,'actionable work precedes recommendations');
  if(width<700)assert.ok(listBox.y<500,'mobile first screen includes actionable work');
  await page.screenshot({path:out+'/todo-list-'+width+'.png',fullPage:true});
  await page.locator('.task-index-item').filter({hasText:'验证默认任务'}).click();
  await page.locator('.task-object-features [aria-label="对象特征"]').waitFor();
  await page.screenshot({path:out+'/todos-'+width+'.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.goto(base+'/?archive='+subject.id);await page.locator('.entity-heading h1').filter({hasText:subject.name??'虚构对象特征验收'}).waitFor();
  const features=page.locator('.archive-tags [aria-label="对象特征"]');await features.waitFor();
  assert.ok((await features.locator('.tag-binding-button').first().innerText()).includes('特征7'));
  assert.equal(await features.locator('.tag-binding-button').count(),6);
  await features.getByRole('button',{name:'展开其余 1 项',exact:true}).click();assert.equal(await features.locator('.tag-binding-button').count(),7);
  await features.locator('.tag-binding-button').filter({hasText:'特征1'}).click();
  const evidence=page.getByRole('dialog').last();await evidence.getByText('本次虚构验收明确提供的特征依据。',{exact:true}).waitFor();
  await evidence.screenshot({path:out+'/feature-evidence-'+width+'.png'});await page.keyboard.press('Escape');
  await features.getByRole('button',{name:'收起特征',exact:true}).click();assert.equal(await features.locator('.tag-binding-button').count(),6);
  await page.getByRole('button',{name:'编辑档案',exact:true}).click();const editor=page.getByRole('dialog',{name:'编辑档案',exact:true});
  await editor.getByRole('tab',{name:'标签',exact:true}).click();assert.equal(await editor.locator('.tag-binding-button').count(),7);
  await editor.screenshot({path:out+'/feature-editor-'+width+'.png'});assert.equal(await editor.evaluate(e=>e.scrollWidth>e.clientWidth+1),false);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'编辑档案',exact:true}).click();const profile=page.getByRole('dialog',{name:'编辑档案',exact:true});
  if(!await profile.getByRole('textbox',{name:'联系方式1',exact:true}).count())await profile.getByRole('button',{name:'＋ 添加联系方式',exact:true}).click();
  await profile.getByLabel('联系方式1类型',{exact:true}).selectOption('邮箱');await profile.getByRole('textbox',{name:'联系方式1',exact:true}).fill('fixture-'+width+'@example.invalid');
  await profile.getByRole('tab',{name:'标签',exact:true}).click();await profile.getByRole('tab',{name:'资料',exact:true}).click();
  assert.equal(await profile.getByRole('textbox',{name:'联系方式1',exact:true}).inputValue(),'fixture-'+width+'@example.invalid');
  await profile.getByRole('button',{name:'保存资料',exact:true}).click();await profile.waitFor({state:'detached'});await page.locator('.contact-pill').filter({hasText:'fixture-'+width+'@example.invalid'}).waitFor();
  if(!await page.getByRole('textbox',{name:'新的观察记录',exact:true}).isVisible())await page.getByRole('button',{name:'开始撰写观察',exact:true}).click();
  const observation='虚构前端纠偏 '+width+'px 完整发布验收。';await page.getByRole('textbox',{name:'新的观察记录',exact:true}).fill(observation);
  await page.getByRole('button',{name:'发布记录',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/composer-'+width+'.png',fullPage:true});
  await page.getByRole('button',{name:'发布记录',exact:true}).click();await page.locator('.record-body').filter({hasText:observation}).waitFor();
  const persisted=await context.request.get(base+'/api/archives/'+subject.id),saved=(await persisted.json()).archive;
  assert.equal(saved.contacts[0].value,'fixture-'+width+'@example.invalid');
  report.push({width,defaultTodo:true,legacyArchiveLink:true,focusedFeatureFirst:true,expandAndCollapse:true,evidence:true,completeEditor:true,profileSaved:true,observationPublished:true});
 }
 assert.deepEqual(errors,[]);writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});console.log('PAGE ERRORS',errors);throw error;}
finally{await browser.close();await preview.close();await new Promise(r=>server.close(r));await f.close();}
