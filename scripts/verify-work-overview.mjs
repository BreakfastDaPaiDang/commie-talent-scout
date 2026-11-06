// Isolated real HTTP worker + SQLite services. No production records or credentials.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer as createViteServer} from 'vite';
import {chromium} from 'playwright-core';
import {fixture} from '../tests/d1-fixture.mjs';
import worker from '../app/server/index.ts';
import {digest} from '../app/server/types.ts';
import {overviewDemo} from '../app/shared/work-overview-demo.ts';
import {dayMs} from '../app/shared/work-overview.ts';

const f=fixture(),demo=overviewDemo(),token=randomUUID(),base='http://127.0.0.1:8796',out='tmp/verification/work-overview-v2';mkdirSync(out,{recursive:true});
f.sqlite.prepare('UPDATE members SET role=? WHERE id=?').run('admin',f.actor.id);f.actor.role='admin';f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'session','ui-fixture',1,?,'2099-01-01T00:00:00.000Z')").run(randomUUID(),f.actor.id,await digest(token),new Date().toISOString());
// Seed the observed histories, not a second hand-built UI dataset.
for(const p of demo.people){
 f.sqlite.prepare("INSERT INTO archives(id,type,name,status,person_role,created_by,created_at,updated_at) VALUES(?,'person',?,?,?,?,?,?)").run(p.id,p.name,p.status,p.person_role,f.actor.id,p.created_at,p.created_at);
 for(const [i,s] of p.segments.entries())f.sqlite.prepare("INSERT INTO archive_events(id,archive_id,actor_id,source,kind,before_json,after_json,created_at) VALUES(?,?,?,'web',?,?,?,?)").run(s.id,p.id,f.actor.id,i?'archive.state_changed':'archive.created',JSON.stringify(i?{status:p.segments[i-1].status}:null),JSON.stringify({status:s.status}),s.start);
 for(const s of p.segments)for(const x of s.placements)f.sqlite.prepare('INSERT INTO work_overview_placements(id,archive_id,event_id,resource_ids_json,note,usage,updated_at) VALUES(?,?,?,?,?,?,?)').run(x.id,p.id,s.id,JSON.stringify(x.resource_ids),x.note,x.usage,demo.as_of);
}
// FK resource references are JSON values, allowing imports of independently seeded fixtures.
for(const r of demo.resources)f.sqlite.prepare('INSERT INTO work_overview_resources(id,name,kind,purposes_json,capacity,active,note,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(r.id,r.name,r.kind,JSON.stringify(r.purposes),r.capacity,r.note,demo.as_of);
for(const g of demo.gaps)f.sqlite.prepare('INSERT INTO work_overview_gaps(id,purpose,work,missing,updated_at) VALUES(?,?,?,?,?)').run(g.id,g.purpose,g.work,g.missing,demo.as_of);
const root=resolve('dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
f.env.ASSETS={async fetch(request){const pathname=decodeURIComponent(new URL(request.url).pathname);const file=resolve(root,'.'+pathname);if(!file.startsWith(root))return new Response('',{status:404});const target=existsSync(file)&&extname(file)?file:resolve(root,'index.html');return new Response(readFileSync(target),{headers:{'Content-Type':mime[extname(target)]??'application/octet-stream'}});}};
const pending=[];
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);const request=new Request(base+req.url,{method:req.method,headers:req.headers,...(body.length?{body}: {})});const response=await worker.fetch(request,f.env,{waitUntil:p=>pending.push(p.catch(()=>{}))});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(8796,'127.0.0.1',r));
const preview=await createViteServer({configFile:false,root:resolve('prototypes/frontend'),publicDir:resolve('public'),resolve:{dedupe:['react','react-dom']},server:{host:'127.0.0.1',port:5196,strictPort:true,fs:{allow:[resolve('.')]}}});await preview.listen();
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1080}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await context.addCookies([{name:'cts_session',value:token,url:base}]);
try{
 await page.goto(base+'/statistics/work');await page.getByRole('heading',{name:'工作总览',exact:true}).waitFor();await page.getByRole('button',{name:'林晓',exact:true}).waitFor();
 assert.equal(await page.locator('.wo-row').count(),5);
 await page.screenshot({path:out+'/desktop-4x3.png',fullPage:true});
 await page.getByRole('button',{name:'可接收人数',exact:true}).click();assert.equal(await page.getByRole('button',{name:'可接收人数',exact:true}).getAttribute('aria-pressed'),'true');await page.locator('.wo-charts').screenshot({path:out+'/capacity-and-forecast.png'});
 await page.getByRole('button',{name:'维护资源',exact:true}).click();await page.getByRole('button',{name:'＋ 新建资源',exact:true}).click();
 await page.getByLabel('资源名称',{exact:true}).fill('界面验证资源');await page.getByLabel('资源类型',{exact:true}).fill('项目');await page.getByLabel('可接收人数',{exact:true}).fill('12');
 await page.screenshot({path:out+'/resource-form-desktop.png',fullPage:true});await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});await page.reload();await page.getByRole('button',{name:'维护资源',exact:true}).click();await page.getByRole('button',{name:/界面验证资源/}).click();assert.equal(await page.getByLabel('可接收人数',{exact:true}).inputValue(),'12');await page.getByLabel('说明',{exact:true}).fill('修改后保留');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
 await page.getByRole('button',{name:'＋ 记录缺口',exact:true}).click();await page.getByLabel('为了完成什么工作').fill('落实一次联系');await page.getByLabel('目前缺什么').fill('需要一位接待人');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});await page.getByRole('button',{name:'落实一次联系 需要一位接待人'}).waitFor();
 await page.getByRole('button',{name:/林晓.*第1段/}).click();await page.getByRole('button',{name:'编辑本段落实'}).click();await page.getByLabel('实际行动与落实说明').fill('已经安排沟通');await page.getByRole('combobox',{name:/落实情况/}).selectOption('active');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});await page.getByRole('button',{name:/林晓.*第1段/}).click();await page.getByText('已经安排沟通',{exact:true}).waitFor();await page.keyboard.press('Escape');
 // Actual task creation reuses the existing form and associates this exact archive.
 await page.getByRole('button',{name:/陈禾.*第1段/}).click();await page.getByRole('button',{name:'创建跟进任务'}).click();await page.getByRole('dialog',{name:'发布任务'}).waitFor();await page.getByText('关联档案：陈禾',{exact:true}).waitFor();await page.screenshot({path:out+'/task-form-desktop.png',fullPage:true});await page.getByRole('button',{name:'发布任务',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks WHERE archive_id=?').get(demo.people[1].id).n,1);
 const taskId=f.sqlite.prepare('SELECT task_id FROM work_overview_followups WHERE archive_id=?').get(demo.people[1].id).task_id;
 await page.goto(base+'/tasks?task='+taskId);await page.getByRole('button',{name:'指派负责人',exact:true}).click();await page.getByRole('button',{name:'负责人',exact:true}).click();await page.getByRole('option').filter({hasText:f.actor.name}).click();await page.getByLabel('指派说明',{exact:true}).fill('明确本次联系责任');await page.screenshot({path:out+'/assignment-desktop.png',fullPage:true});await page.getByRole('button',{name:'确认指派',exact:true}).click();await page.getByRole('dialog',{name:'指派负责人',exact:true}).waitFor({state:'detached'});assert.equal(f.sqlite.prepare('SELECT owner_id FROM work_tasks WHERE id=?').get(taskId).owner_id,f.actor.id);
 await page.goto(base+'/statistics/work');await page.getByRole('button',{name:/陈禾.*第1段/}).click();await page.getByRole('button',{name:/联系跟进/}).waitFor();await page.keyboard.press('Escape');await page.getByLabel('对象范围').getByRole('button',{name:'组织',exact:true}).click();await page.getByText('当前范围没有档案').waitFor();await page.getByRole('button',{name:'人员',exact:true}).click();await page.getByRole('button',{name:'林晓',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'维护资源',exact:true}).click();await page.getByRole('button',{name:/界面验证资源/}).click();await page.getByLabel('说明',{exact:true}).fill('手机端保存');await page.locator('.wo-editor fieldset').evaluate(el=>{el.scrollTop=el.scrollHeight;});await page.screenshot({path:out+'/resource-form-mobile.png',fullPage:true});await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(f.sqlite.prepare('SELECT note FROM work_overview_resources WHERE name=?').get('界面验证资源').note,'手机端保存');
 await page.goto(base+'/tasks?task='+taskId);await page.getByRole('button',{name:'指派负责人',exact:true}).click();await page.getByRole('button',{name:'负责人',exact:true}).click();await page.getByRole('option').filter({hasText:f.actor.name}).click();await page.getByLabel('指派说明',{exact:true}).fill('手机端核对指派');await page.screenshot({path:out+'/assignment-mobile.png',fullPage:true});await page.getByRole('button',{name:'确认指派',exact:true}).click();await page.getByRole('dialog',{name:'指派负责人',exact:true}).waitFor({state:'detached'});
 await page.goto('http://127.0.0.1:5196/?work-overview');await page.getByRole('heading',{name:/工作总览/}).waitFor();await page.getByRole('button',{name:'林晓',exact:true}).waitFor();await page.setViewportSize({width:1440,height:1080});await page.screenshot({path:out+'/shared-preview.png',fullPage:true});
 assert.deepEqual(errors,[]);writeFileSync(out+'/result.json',JSON.stringify({passed:true,desktop:'1440x1080',mobile:'390x844',realHttp:true,sharedPrototype:true,checks:['resource create/edit/reload','manual gaps','phase placement edit/readback','task create archive association and owner assignment','person/org isolation','mobile save','shared prototype'],errors},null,2));console.log('work-overview: desktop/mobile, real HTTP saves and shared prototype passed');
}catch(error){await page.screenshot({path:out+'/failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-2200));throw error;}finally{await browser.close();await preview.close();await new Promise(r=>server.close(r));await Promise.all(pending);f.close();}
