// Real task HTTP API and isolated SQLite; emulate a browser without randomUUID.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer as createViteServer} from 'vite';
import {chromium} from 'playwright-core';
import {fixture} from '../tests/d1-fixture.mjs';
import worker from '../app/server/index.ts';
import {digest} from '../app/server/types.ts';
import {WorkTasks} from '../app/server/work-tasks.ts';

const reproduce=process.argv.includes('--reproduce');
const f=fixture(),base='http://127.0.0.1:8798',token=randomUUID();
const out='tmp/verification/browser-crypto';mkdirSync(out,{recursive:true});
f.env.APP_ORIGIN=base;
f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'session','ui-fixture',1,?,'2099-01-01T00:00:00.000Z')")
 .run(randomUUID(),f.actor.id,await digest(token),new Date().toISOString());
const root=resolve('dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
f.env.ASSETS={async fetch(request){
 const file=resolve(root,'.'+decodeURIComponent(new URL(request.url).pathname));
 if(file!==root&&!file.startsWith(root+sep))return new Response('',{status:404});
 const target=existsSync(file)&&extname(file)?file:resolve(root,'index.html');
 return new Response(readFileSync(target),{headers:{'Content-Type':mime[extname(target)]??'application/octet-stream'}});
}};
const pending=[];
const server=createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
  const request=new Request(base+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{})});
  const response=await worker.fetch(request,f.env,{waitUntil:p=>pending.push(p.catch(()=>{}))});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(r=>server.listen(8798,'127.0.0.1',r));
let browser,preview;const report=[];
try{
 browser=await chromium.launch({channel:'msedge',headless:true});
 for(const missing of reproduce?[true]:[true,false]){
  const title=missing?'手机兼容验证':'手机原生验证';
  const task=await new WorkTasks(f.env,f.actor,'web').create({kind:'custom',title,purpose:'验证真实领取与评论',delivery:'记录验证结果',deadline_at:'2099-01-01T00:00:00.000Z',request_id:randomUUID()});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.addCookies([{name:'cts_session',value:token,url:base}]);
  await context.addInitScript(missing=>{
   if(missing)Object.defineProperty(crypto,'randomUUID',{value:undefined,writable:true,configurable:true});
   window.__uuidAtBoot=crypto.randomUUID;
  },missing);
  const page=await context.newPage(),errors=[],writes=[];
  page.setDefaultTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/work-tasks/'))writes.push({path:new URL(r.url()).pathname,input:r.postDataJSON()});});
  await page.goto(base+'/tasks?task='+task.id);
  await page.getByRole('button',{name:'看板大厅',exact:true}).click();
  await page.getByRole('heading',{name:title,exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'任务详情',exact:true});
  await dialog.waitFor();
  if(reproduce){
   await page.evaluate(()=>{document.documentElement.dataset.theme='night';});
   await dialog.getByRole('button',{name:'领取任务',exact:true}).click();
   await dialog.getByText('crypto.randomUUID is not a function',{exact:true}).waitFor();
   assert.equal(writes.length,0,'failure occurs before any task mutation request');
   assert.equal(f.sqlite.prepare('SELECT owner_id FROM work_tasks WHERE id=?').get(task.id).owner_id,null);
   await page.screenshot({path:out+'/before-mobile.png',fullPage:true});
   report.push({reproduced:true,taskMutationRequests:0,databaseUnchanged:true});
   await context.close();continue;
  }
  assert.equal(await page.evaluate(()=>typeof crypto.randomUUID),'function');
  assert.equal(await page.evaluate(()=>typeof window.__uuidAtBoot),missing?'undefined':'function');
  if(!missing)assert.equal(await page.evaluate(()=>crypto.randomUUID===window.__uuidAtBoot),true,'native implementation stays intact');
  await dialog.getByRole('button',{name:'领取任务',exact:true}).click();
  await dialog.getByRole('button',{name:'提交交付',exact:true}).waitFor();
  assert.equal(f.sqlite.prepare('SELECT owner_id FROM work_tasks WHERE id=?').get(task.id).owner_id,f.actor.id);
  const comment=missing?'兼容模式手机评论已保存':'原生模式手机评论已保存';
  await dialog.getByRole('textbox',{name:'任务评论',exact:true}).fill(comment);
  await dialog.getByRole('button',{name:'发表评论',exact:true}).click();
  await dialog.getByText(comment,{exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:'看板大厅',exact:true}).click();await page.getByRole('heading',{name:title,exact:true}).click();await dialog.getByRole('button',{name:'提交交付',exact:true}).waitFor();
  await dialog.getByText(comment,{exact:true}).waitFor();
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM work_task_events WHERE task_id=? AND kind='task.claimed'").get(task.id).n,1);
  assert.deepEqual(writes.map(x=>x.path),['/api/work-tasks/claim','/api/work-tasks/comments/create']);
  const ids=writes.map(x=>x.input.request_id);
  for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(ids).size,2);
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>{document.documentElement.dataset.theme='night';});
  await page.screenshot({path:out+(missing?'/fallback-mobile.png':'/native-mobile.png'),fullPage:true});
  report.push({nativeRandomUUID:!missing,claimed:true,commentPersistsAfterReload:true,distinctRequestIDs:true,pageErrors:errors});
  await context.close();
 }
 if(!reproduce){
  preview=await createViteServer({configFile:false,root:resolve('prototypes/frontend'),publicDir:resolve('public'),resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:5198,strictPort:true,fs:{allow:[resolve('.')]}}});
  await preview.listen();
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{Object.defineProperty(crypto,'randomUUID',{value:undefined,writable:true,configurable:true});});
  await page.goto('http://127.0.0.1:5198/?knowledge');
  await page.getByRole('heading',{name:'知识库',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>typeof crypto.randomUUID),'function');
  assert.deepEqual(errors,[]);
  report.push({prototypeBootWithoutNativeUUID:true,pageErrors:errors});
 }
 writeFileSync(out+(reproduce?'/reproduction.json':'/results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{
 await browser?.close();await preview?.close();
 await new Promise(r=>server.close(r));await Promise.allSettled(pending);f.close();
}
