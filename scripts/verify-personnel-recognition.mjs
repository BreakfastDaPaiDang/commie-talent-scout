// Real HTTP + MCP + production React, isolated SQLite and fabricated people only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {randomUUID as uuid} from 'node:crypto';
import {chromium} from 'playwright-core';
import {fixture} from '../tests/d1-fixture.mjs';
import {formalActor} from '../tests/personnel-fixture.mjs';
import worker from '../app/server/index.ts';
import {digest} from '../app/server/types.ts';
const f=fixture(),base='http://127.0.0.1:8798',out='tmp/verification/personnel-recognition',pending=[];mkdirSync(out,{recursive:true});
const actors=[formalActor(f,{accountId:f.actor.id,name:f.actor.name}),formalActor(f,{name:'虚构认可乙'}),formalActor(f,{name:'虚构认可丙'})];
const tokens=[];let session;
for(const [i,actor] of actors.entries()){const token=uuid(),at=new Date().toISOString();tokens.push(token);f.sqlite.prepare('UPDATE credentials SET hash=? WHERE id=?').run(await digest(token),actor.credential_id);if(i===0){session=uuid();f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'session','验收',1,?,'2099-01-01T00:00:00Z')").run(uuid(),actor.id,await digest(session),at);}}
const root=resolve('dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
f.env.ASSETS={async fetch(req){const p=resolve(root,'.'+decodeURIComponent(new URL(req.url).pathname));if(p!==root&&!p.startsWith(root+sep))return new Response('',{status:403});const path=existsSync(p)&&extname(p)?p:resolve(root,'index.html');return new Response(readFileSync(path),{headers:{'Content-Type':mime[extname(path)]??'application/octet-stream'}});}};
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks),r=await worker.fetch(new Request(base+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{})}),f.env,{waitUntil:p=>pending.push(p.catch(()=>{}))});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(8798,'127.0.0.1',r));
async function api(path,body,index=0){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+tokens[index],Origin:base,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
async function mcp(name,args,index=1){const r=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokens[index],'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:uuid(),method:'tools/call',params:{name,arguments:args}})});const text=await r.text();assert.equal(r.status,200,text);const json=text.startsWith('data:')||text.includes('\ndata:')?JSON.parse(text.split('\n').find(l=>l.startsWith('data: ')).slice(6)):JSON.parse(text);assert.ok(!json.error,JSON.stringify(json));assert.ok(!json.result.isError,JSON.stringify(json));return json.result.structuredContent??JSON.parse(json.result.content.find(c=>c.type==='text').text);}
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await context.addCookies([{name:'cts_session',value:session,url:base}]);
try{
 const a=await api('/archives/create',{type:'person',name:'虚构人员认可验收',request_id:uuid()}),o=await api('/observations/create',{archive_id:a.id,body:'已在实际协作中完成一项文案校对，能说明依据并及时反馈困难。',request_id:uuid()});
 const input={archive_id:a.id,round_number:1,observation_id:o.id,content_version:1,request_id:uuid()};
 await page.goto(base+'/?archive='+a.id);await page.getByRole('button',{name:'认可此人',exact:true}).waitFor();
 assert.equal(await page.locator('.personnel-recognition').count(),0);
 const contrastChecks=[];
 for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});await page.getByRole('button',{name:'认可此人',exact:true}).click();const dialog=page.getByRole('dialog',{name:'认可此人',exact:true});await dialog.waitFor();await dialog.getByText('本月剩余 2/2 份',{exact:false}).waitFor();
  for(const theme of ['light','night']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);const contrast=await dialog.locator('blockquote').evaluate(el=>{const s=getComputedStyle(el),luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(n=>{const c=Number(n)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const a=luminance(s.color),b=luminance(s.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});assert.ok(contrast>=4.5,`${theme} ${width}px evidence contrast ${contrast}`);contrastChecks.push({theme,width,contrast});await dialog.screenshot({path:`${out}/confirm-${width}-${theme}.png`});}
  await page.evaluate(()=>document.documentElement.dataset.theme='light');await dialog.screenshot({path:`${out}/confirm-${width}.png`});if(width===1440)await dialog.getByRole('button',{name:'关闭'}).click();}
 await page.getByRole('dialog',{name:'认可此人',exact:true}).getByRole('button',{name:'确认认可',exact:true}).click();await page.getByRole('dialog',{name:'认可此人',exact:true}).waitFor({state:'detached'});const records=page.locator('.personnel-recognition details'),toggle=records.locator('summary');
 await page.getByText('已有 1 人认可',{exact:true}).waitFor();
 assert.equal(await records.getAttribute('open'),null);
 assert.doesNotMatch(await page.locator('.personnel-recognition').innerText(),/本月剩余|三名社员/);
 await toggle.focus();await page.keyboard.press('Enter');await records.getByRole('button',{name:'撤回认可'}).waitFor();
 await page.keyboard.press('Enter');assert.equal(await records.getAttribute('open'),null);
 assert.equal((await api('/personnel-recognition/'+a.id)).quota.remaining,1);
 const guide=await mcp('get_usage_guide',{topic:'personnel_recognition'});assert.ok(guide.rules.some(s=>s.includes('明确授权')));
 const second=await mcp('recognize_person',input);assert.equal(second.count,2);assert.equal(second.task_id,null);const replay=await mcp('recognize_person',input);assert.equal(replay.replayed,true);assert.equal((await mcp('get_personnel_recognition',{archive_id:a.id})).quota.remaining,1);
 const third=await api('/personnel-recognition/recognize',{...input,request_id:uuid()},2);assert.equal(third.count,3);assert.equal(third.triggered,true);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks WHERE archive_id=?').get(a.id).n,1);assert.equal(f.sqlite.prepare('SELECT owner_id FROM work_tasks WHERE id=?').get(third.task_id).owner_id,null);
 await page.reload();await page.getByRole('link',{name:'查看人事审核任务 ↗'}).waitFor();await page.locator('.personnel-recognition summary').click();assert.equal(await page.getByRole('link',{name:'查看依据 · 版本 1',exact:true}).count(),3);await page.screenshot({path:out+'/recognized-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'查看人事审核任务 ↗'}).click();await page.getByRole('button',{name:'领取任务',exact:true}).waitFor();
 // A withdrawn last vote still has a history, even with zero active recognitions.
 const other=await api('/archives/create',{type:'person',name:'虚构撤回记录',request_id:uuid()});
 const otherObs=await api('/observations/create',{archive_id:other.id,body:'第二份样本观察。',request_id:uuid()});
 await api('/personnel-recognition/recognize',{archive_id:other.id,observation_id:otherObs.id,content_version:1,round_number:1,request_id:uuid()});
 await page.goto(base+'/people?archive='+other.id);await page.getByText('已有 1 人认可',{exact:true}).click();
 await page.getByRole('button',{name:'撤回认可',exact:true}).click();
 await page.getByRole('button',{name:'确认撤回',exact:true}).click();
 await page.getByRole('dialog',{name:'撤回人员认可'}).waitFor({state:'detached'});
 await page.reload();await page.getByText('认可记录',{exact:true}).click();
 await records.getByText('已撤回',{exact:true}).waitFor();
 // Existing task delivery remains the only route from review to onboarding to membership.
 let claim=await api('/work-tasks/claim',{id:third.task_id,expected_version:1,request_id:uuid()});let evidence=await api('/observations/create',{archive_id:a.id,body:'本轮审核有依据地确认通过。',request_id:uuid()});
 let delivered=await api('/work-tasks/complete',{id:third.task_id,expected_version:claim.version,result_kind:'audit_passed',result_text:'审核通过',references:[{observation_id:evidence.id,content_version:1}],request_id:uuid()});assert.equal(delivered.archive_status,'已加入待对接');
 claim=await api('/work-tasks/claim',{id:delivered.next_task_id,expected_version:1,request_id:uuid()});evidence=await api('/observations/create',{archive_id:a.id,body:'已完成实际入社对接。',request_id:uuid()});
 delivered=await api('/work-tasks/complete',{id:claim.id,expected_version:claim.version,result_kind:'onboarding_completed',result_text:'对接完成',references:[{observation_id:evidence.id,content_version:1}],request_id:uuid()});assert.equal(delivered.membership_joined,true);
 assert.deepEqual(errors,[]);writeFileSync(out+'/result.json',JSON.stringify({passed:true,realHttp:true,realMcp:true,desktop:[1440,1000],mobile:[390,844],contrastChecks,checks:['read evidence','web confirmation and monthly quota','MCP same rules and retry','third distinct member creates one unclaimed task','reference links and fixed versions','audit and onboarding deliveries reach membership','light/night evidence contrast >= 4.5','no page errors'],errors},null,2));console.log('personnel-recognition: web/MCP, quotas, references, idempotency, desktop/mobile, light/night contrast and complete personnel lifecycle passed');
}catch(e){await page.screenshot({path:out+'/failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-2000));throw e;}finally{await browser.close();await new Promise(r=>server.close(r));await Promise.allSettled(pending);f.close();}
