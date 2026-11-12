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

const f=await connectedFixture(),base='http://127.0.0.1:8798',out='tmp/verification/whale-home-live';mkdirSync(out,{recursive:true});
const identity=(await f.call('/api/identity')).body,services=[identity,...f.k.actors.slice(1,3)].map(a=>new KnowledgeWorkspace(f.k.db,a));
const writer=services[0],titles=['审核应该了解什么','验证目标的理论能力','从实际作品展开追问','已知信息不必重复询问','资料整理需要校对协作'];
const body='从参与意愿、能力与投入、协作与支持三个方面，梳理审核需要重点了解的内容。\n\n## 参与意愿\n了解对方加入的动机与期望，确认其对组织定位与现状有基本认识。\n\n## 能力与投入\n结合过往经历或作品判断实际水平。了解可以投入的时间与精力。\n\n## 协作与支持\n了解沟通方式与协作习惯，以及所需的资源、工具和指导。';
let branch=await writer.createBranch({name:'初始共识',request_id:request()}),first;
for(const [i,title] of titles.entries()){const doc=await writer.save({branch_id:branch.id,expected_version:branch.version,title,body:i?title+'的示例内容。':body,category:i===4?'组织':'知性',kind:i===4?'需求':i%2?'方法':'共识',message:'建立验收文档',request_id:request()});branch.version=doc.version;if(!first)first=doc;}
let merge=await writer.propose({branch_id:branch.id,expected_version:branch.version,title:'初始共识',reason:'虚构验收材料',request_id:request()});for(const s of services)await s.approve({id:merge.id,head_id:merge.head_id,request_id:request()});await writer.accept({id:merge.id,head_id:merge.head_id,main_version:1,request_id:request()});
const root=resolve('dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
f.p.env.ASSETS={async fetch(req){const path=resolve(root,'.'+decodeURIComponent(new URL(req.url).pathname));if(path!==root&&!path.startsWith(root+sep))return new Response('',{status:403});const file=existsSync(path)&&extname(path)?path:resolve(root,'index.html');return new Response(readFileSync(file),{headers:{'Content-Type':mime[extname(file)]??'application/octet-stream'}});}};
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks),response=await personnel.fetch(new Request(base+req.url,{method:req.method,headers:req.headers,...(bytes.length?{body:bytes}:{})}),f.p.env,f.ctx);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(8798,'127.0.0.1',r));
const preview=await createViteServer({configFile:false,root:resolve('prototypes/frontend'),publicDir:resolve('public'),resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:5198,strictPort:true,fs:{allow:[resolve('.')]},proxy:{'/api':{target:base,changeOrigin:true}}}});await preview.listen();
const browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER==='chrome'?'chrome':'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1080}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await context.addCookies([{name:'cts_session',value:f.session,url:base}]);

const report=[];
try{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  for(const [name,path,selector] of [
   ['外部人物','/people','.archive-head'],['社员','/members','.archive-head'],['任务','/tasks','.task-workspace'],
   ['仪表盘','/statistics','.statistics-page'],['知识库','/knowledge','.kb-workspace'],['Agent 接入','/agent','.agent-simple']
  ]){
   await page.goto(base+'/');await page.locator('.whale-entrance--blue').waitFor();
   await page.getByRole('link',{name,exact:true}).click();
   await page.waitForURL(url=>url.pathname===path);await page.locator(selector).first().waitFor();
   if(name==='外部人物')assert.equal(await page.locator('.archive-kind-switcher').count(),0);
   await page.locator('.topbar .brand').click();await page.locator('.whale-constellation').waitFor();
   report.push({width,name,path,realHttp:true,returnHome:true});
  }
  await page.goto(base+'/');await page.locator('.whale-entrance img').evaluateAll(els=>Promise.all(els.map(el=>el.decode())));
  await page.screenshot({path:out+'/home-'+width+'.png',fullPage:true});
 }
 assert.deepEqual(errors,[]);writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});console.log('PAGE ERRORS',errors);throw error;}
finally{await browser.close();await preview.close();await new Promise(r=>server.close(r));await f.close();}
