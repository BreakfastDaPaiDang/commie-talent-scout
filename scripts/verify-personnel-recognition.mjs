// Real HTTP + MCP + production React, isolated SQLite and fabricated people only.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {createHash,randomUUID as uuid} from 'node:crypto';
import {chromium} from 'playwright-core';
import {fixture} from '../tests/d1-fixture.mjs';
import {formalActor} from '../tests/personnel-fixture.mjs';
import worker from '../app/server/index.ts';
import {digest} from '../app/server/types.ts';
const f=fixture(),base='http://127.0.0.1:8798',out='tmp/verification/personnel-recognition',pending=[];mkdirSync(out,{recursive:true});
const names=['许照','程溪','梁知远'];
f.sqlite.prepare('UPDATE members SET name=?,qq=NULL WHERE id=?').run(names[0],f.actor.id);
const actors=[formalActor(f,{accountId:f.actor.id,name:names[0]}),formalActor(f,{name:names[1]}),formalActor(f,{name:names[2]})];
const tokens=[];let session;
for(const [i,actor] of actors.entries()){const token=uuid(),at=new Date().toISOString();tokens.push(token);f.sqlite.prepare('UPDATE credentials SET hash=? WHERE id=?').run(await digest(token),actor.credential_id);if(i===0){session=uuid();f.sqlite.prepare("INSERT INTO credentials(id,member_id,hash,kind,name,auth_epoch,created_at,expires_at) VALUES(?,?,?,'session','验收',1,?,'2099-01-01T00:00:00Z')").run(uuid(),actor.id,await digest(session),at);}}
const root=resolve(process.env.CTS_UI_DIST??'dist'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
f.env.ASSETS={async fetch(req){const p=resolve(root,'.'+decodeURIComponent(new URL(req.url).pathname));if(p!==root&&!p.startsWith(root+sep))return new Response('',{status:403});const path=existsSync(p)&&extname(p)?p:resolve(root,'index.html');return new Response(readFileSync(path),{headers:{'Content-Type':mime[extname(path)]??'application/octet-stream'}});}};
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks),r=await worker.fetch(new Request(base+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{})}),f.env,{waitUntil:p=>pending.push(p.catch(()=>{}))});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(8798,'127.0.0.1',r));
async function api(path,body,index=0){const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+tokens[index],Origin:base,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
async function mcp(name,args,index=1){const r=await fetch(base+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokens[index],'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:uuid(),method:'tools/call',params:{name,arguments:args}})});const text=await r.text();assert.equal(r.status,200,text);const json=text.startsWith('data:')||text.includes('\ndata:')?JSON.parse(text.split('\n').find(l=>l.startsWith('data: ')).slice(6)):JSON.parse(text);assert.ok(!json.error,JSON.stringify(json));assert.ok(!json.result.isError,JSON.stringify(json));return json.result.structuredContent??JSON.parse(json.result.content.find(c=>c.type==='text').text);}
async function fixtureAvatar(type,id,index,file,mimeType){
 const bytes=readFileSync(new URL('../tests/fixtures/images/'+file,import.meta.url));
 const target=type==='archive'?{purpose:'archive_avatar',archive_id:id}:{purpose:'member_avatar',member_id:id};
 const ticket=await api('/images/prepare',{...target,mime_type:mimeType,byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},index);
 const response=await fetch(ticket.url,{method:'PUT',headers:ticket.headers,body:bytes});
 assert.equal(response.status,200,await response.text());
 await api('/avatars/set',{subject_type:type,id,expected_version:1,attachment_id:ticket.attachment_id,request_id:uuid()},index);
}
function luminance(color){
 const rgb=color.match(/[\d.]+/g).slice(0,3).map(value=>{
  const channel=Number(value)/255;
  return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;
 });
 return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
}
async function contrastRatio(foreground,background=foreground){
 const text=luminance(await foreground.evaluate(el=>getComputedStyle(el).color));
 const fill=luminance(await background.evaluate(el=>getComputedStyle(el).backgroundColor));
 return (Math.max(text,fill)+.05)/(Math.min(text,fill)+.05);
}
const browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await context.addCookies([{name:'cts_session',value:session,url:base}]);
try{
 await fixtureAvatar('archive',actors[0].archiveId,0,'shapes.png','image/png');
 await fixtureAvatar('member',actors[1].id,1,'shapes.jpg','image/jpeg');
 const a=await api('/archives/create',{
  type:'person',name:'唐小满',current_need:'想通过整理访谈资料参与协作，了解团队的编辑流程。',
  contacts:[{type:'邮箱',value:'tang@example.invalid'}],request_id:uuid()
 });
 await fixtureAvatar('archive',a.id,0,'shapes.webp','image/webp');
 const originalEvidence='已在实际协作中完成一项文案校对，能说明依据并及时反馈困难。';
 const o=await api('/observations/create',{archive_id:a.id,body:originalEvidence,request_id:uuid()});
 const category=await api('/tag-categories/create',{type:'person',name:'技能',color:'blue',request_id:uuid()});
 const tag=await api('/tags/create',{category_id:category.id,name:'采访整理',description:'能整理访谈材料并提炼主题。',request_id:uuid()});
 const current=await api('/archives/'+a.id);
 await api('/archive-tags/update',{archive_id:a.id,expected_version:current.archive.version,changes:[{tag_id:tag.id,action:'add'}],request_id:uuid()});
 const input={archive_id:a.id,round_number:1,observation_id:o.id,content_version:1,request_id:uuid()};
 await page.goto(base+'/?archive='+a.id);await page.getByRole('button',{name:'认可此人',exact:true}).waitFor();
 assert.equal(await page.locator('.personnel-recognition').count(),0);
 const contrastChecks=[];
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:width<600?844:1000});await page.getByRole('button',{name:'认可此人',exact:true}).click();const dialog=page.getByRole('dialog',{name:'认可此人',exact:true});await dialog.waitFor();await dialog.getByText('本月剩余 2/2 份',{exact:false}).waitFor();
  for(const theme of ['light','night']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);const contrast=await contrastRatio(dialog.locator('blockquote'));assert.ok(contrast>=4.5,`${theme} ${width}px evidence contrast ${contrast}`);contrastChecks.push({theme,width,contrast});await dialog.screenshot({path:`${out}/confirm-${width}-${theme}.png`});}
  await page.evaluate(()=>document.documentElement.dataset.theme='light');await dialog.screenshot({path:`${out}/confirm-${width}.png`});if(width!==320)await dialog.getByRole('button',{name:'关闭'}).click();}
 await page.getByRole('dialog',{name:'认可此人',exact:true}).getByRole('button',{name:'确认认可',exact:true}).click();
 await page.getByRole('dialog',{name:'认可此人',exact:true}).waitFor({state:'detached'});
 const summary=page.getByRole('region',{name:'人员认可',exact:true});
 const bar=summary.locator('.recognition-bar'),records=summary.locator('.recognition-votes');
 const toggle=summary.locator('.recognition-disclosure');
 const people=summary.getByRole('list',{name:'认可成员',exact:true});
 const reviewLink=summary.getByRole('link',{name:'已发起审核',exact:true});
 await summary.getByText('1/3 人',{exact:true}).waitFor();
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 assert.equal(await records.isVisible(),false);
 assert.doesNotMatch(await summary.innerText(),/本月剩余|三名社员/);
 await toggle.focus();await page.keyboard.press('Enter');await records.getByRole('button',{name:'撤回认可'}).waitFor();
 assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 await page.setViewportSize({width:1440,height:1000});
 const evidenceLink=records.getByRole('link',{name:'查看依据 · 版本 1',exact:true});
 assert.equal(await evidenceLink.getAttribute('href'),'/people?archive='+a.id+'&observation='+o.id+'&version=1');
 await api('/observations/update',{id:o.id,expected_version:1,body:originalEvidence+' 后续沟通已另行记录。',occurred_at:null,request_id:uuid()});
 await evidenceLink.click();
 await page.locator('#focused-content').getByText(originalEvidence,{exact:true}).waitFor();
 await page.getByRole('button',{name:'返回档案',exact:true}).click();
 const emptyTasks=page.locator('.related-tasks-empty');
 const emptyCount=emptyTasks.getByText('关联任务 0',{exact:true});
 const newTask=emptyTasks.getByRole('link',{name:'新建任务',exact:true});
 await emptyCount.waitFor();
 assert.equal(await newTask.getAttribute('href'),'/tasks?create_for='+a.id+'&work=specific');
 await page.evaluate(()=>document.fonts.ready);
 // Returning from the evidence view can reflow the archive as the timeline loads.
 // Compare all three edges in the same frame.
 await page.waitForFunction(()=>{
  const row=document.querySelector('.related-tasks-empty');
  const count=row?.querySelector(':scope > span');
  const create=row?.querySelector('a');
  if(!row||!count||!create)return false;
  const r=row.getBoundingClientRect(), c=count.getBoundingClientRect(), a=create.getBoundingClientRect();
  return r.width>0 && a.width>0 && Math.abs(c.top+c.height/2-a.top-a.height/2)<=1
   && Math.abs(c.left-r.left)<=1 && Math.abs(a.right-r.right)<=1;
 });
 assert.equal(await page.getByRole('dialog').count(),0);
 await page.locator('.record-byline > .avatar svg').first().waitFor();
 await toggle.evaluate(el=>el.blur());
 await page.locator('.detail-scroll').evaluate(el=>{el.scrollTop=0;});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:out+'/recognition-and-empty-tasks-1440.png',fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:320,height:844});
 if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
 await toggle.focus();
 await page.keyboard.press('Enter');
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 assert.equal((await api('/personnel-recognition/'+a.id)).quota.remaining,1);
 const guide=await mcp('get_usage_guide',{topic:'personnel_recognition'});assert.ok(guide.rules.some(s=>s.includes('明确授权')));
 const secondEvidence=await api('/observations/create',{archive_id:a.id,body:'能逐条核对采访纪要，主动标出需要向受访者确认的信息。',request_id:uuid()},1);
 const secondInput={...input,observation_id:secondEvidence.id};
 const second=await mcp('recognize_person',secondInput);assert.equal(second.count,2);assert.equal(second.task_id,null);const replay=await mcp('recognize_person',secondInput);assert.equal(replay.replayed,true);assert.equal((await mcp('get_personnel_recognition',{archive_id:a.id})).quota.remaining,1);

 async function captureDesktop(state,visibleNames,taskId){
  await page.setViewportSize({width:1440,height:1000});
  await page.reload();
  await summary.getByText(`${visibleNames.length}/3 人`,{exact:true}).waitFor();
  assert.deepEqual(await people.getByRole('listitem').allTextContents(),visibleNames);
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  assert.equal(await records.isVisible(),false);
  assert.equal(await bar.locator('.recognition-mark').count(),taskId?1:0);
  if(taskId)assert.equal(await reviewLink.getAttribute('href'),'/tasks?task='+taskId);
  else assert.equal(await reviewLink.count(),0);
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('.detail-scroll').evaluate(el=>el.scrollTop=0);
  for(const [type,id] of [['archives',actors[0].archiveId],['members',actors[1].id]]){
   const photo=people.locator(`img[src^="/avatars/${type}/${id}?"]`);
   await photo.waitFor();
   assert.ok(await photo.evaluate(async img=>{await img.decode();return img.naturalWidth>0;}));
  }
  if(taskId){
   await people.getByRole('listitem').filter({hasText:names[2]}).locator('.avatar svg').waitFor();
  }
  const featureBox=await page.locator('.archive-tags').boundingBox(),barBox=await bar.boundingBox(),tabsBox=await page.locator('.timeline-tabs').boundingBox();
  const rowElements=await bar.locator('.recognition-heading, .recognition-identity, .recognition-actions').evaluateAll(elements=>elements.map(el=>{
   const box=el.getBoundingClientRect();
   return box.top+box.height/2;
  }));
  assert.ok(barBox.height<=56 && rowElements.every(y=>Math.abs(y-rowElements[0])<=2),'desktop recognition stays on one line '+JSON.stringify({state,barBox,rowElements}));
  assert.ok(featureBox.y+featureBox.height<=barBox.y && barBox.y+barBox.height<=tabsBox.y);
  assert.ok(Math.abs(featureBox.x-barBox.x)<=1 && Math.abs(featureBox.width-barBox.width)<=1);
  assert.ok(await bar.evaluate(el=>el.scrollWidth<=el.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth+1));
  for(const theme of ['light','night']){
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const evidenceContrast=await contrastRatio(toggle,bar),countContrast=await contrastRatio(bar.locator('.recognition-count strong'),bar);
   const taskContrast=taskId?await contrastRatio(reviewLink,bar):null;
   assert.ok(evidenceContrast>=4.5 && countContrast>=4.5 && (taskContrast===null || taskContrast>=4.5),`${state} ${theme} contrast ${evidenceContrast}, ${countContrast}, ${taskContrast}`);
   contrastChecks.push({state,theme,width:1440,evidenceContrast,countContrast,taskContrast});
   await page.screenshot({path:`${out}/recognition-${state}-1440-${theme}.png`,fullPage:true,animations:'disabled'});
  }
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
 }

 await captureDesktop('collecting',names.slice(0,2));
 const thirdEvidence=await api('/observations/create',{archive_id:a.id,body:'共同整理了一份访谈提纲，按约定时间交回并补充了出处。',request_id:uuid()},2);
 const third=await api('/personnel-recognition/recognize',{...input,observation_id:thirdEvidence.id,request_id:uuid()},2);assert.equal(third.count,3);assert.equal(third.triggered,true);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM work_tasks WHERE archive_id=?').get(a.id).n,1);assert.equal(f.sqlite.prepare('SELECT owner_id FROM work_tasks WHERE id=?').get(third.task_id).owner_id,null);
 await captureDesktop('review-started',names,third.task_id);
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  await summary.getByRole('button',{name:'查看认可依据',exact:true}).click();
  assert.equal(await evidenceLink.count(),3);
  assert.ok((await toggle.boundingBox()).height>=44 && (await reviewLink.boundingBox()).height>=44);
  assert.ok(await bar.evaluate(el=>el.scrollWidth<=el.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`${out}/recognized-mobile-${width}.png`,fullPage:true});
  await toggle.click();
  await page.getByRole('button',{name:'编辑档案',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'编辑档案',exact:true});
  await editor.locator('.contact-note summary').click();
  await editor.getByRole('textbox',{name:'联系方式1备注',exact:true}).fill('用于交流访谈整理需求。');
  await editor.getByRole('button',{name:'＋ 添加资料链接',exact:true}).click();
  await editor.getByRole('textbox',{name:'资料链接1名称',exact:true}).fill('采访资料');
  await editor.getByRole('textbox',{name:'资料链接1网址',exact:true}).fill('https://example.invalid/interview');
  await editor.getByRole('tab',{name:'状态与成员',exact:true}).click();
  await editor.getByRole('tab',{name:'资料',exact:true}).click();
  assert.equal(await editor.getByRole('textbox',{name:'联系方式1备注',exact:true}).inputValue(),'用于交流访谈整理需求。');
  assert.ok(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await editor.screenshot({path:`${out}/profile-editor-${width}.png`});
  if(width===320)await editor.getByRole('button',{name:'保存资料',exact:true}).click();
  else await editor.getByRole('button',{name:'关闭对话框',exact:true}).click();
  await editor.waitFor({state:'detached'});
 }
 assert.equal((await api('/archives/'+a.id)).archive.links[0].url,'https://example.invalid/interview');
 // An existing audit stays accessible even after the active count drops.
 await api('/personnel-recognition/withdraw',{id:third.id,request_id:uuid()},2);
 await page.reload();
 await summary.getByText('2/3 人',{exact:true}).waitFor();
 assert.equal(await reviewLink.getAttribute('href'),'/tasks?task='+third.task_id);
 assert.deepEqual(await people.getByRole('listitem').allTextContents(),names.slice(0,2));
 await toggle.click();
 await records.getByText('已撤回',{exact:true}).waitFor();
 await reviewLink.click();
 await page.getByRole('button',{name:'领取任务',exact:true}).waitFor();
 // A withdrawn last vote still has a history, even with zero active recognitions.
 const other=await api('/archives/create',{type:'person',name:'虚构撤回记录',request_id:uuid()});
 await page.goto(base+'/people?archive='+other.id);
 const related=page.getByRole('region',{name:'关联任务',exact:true});
 await related.getByText('关联任务 0',{exact:true}).waitFor();
 assert.equal(await related.getByRole('button',{name:'查看已关闭任务'}).count(),0);
 const createLink=related.getByRole('link',{name:'新建任务',exact:true});
 assert.equal(await createLink.getAttribute('href'),'/tasks?create_for='+other.id+'&work=specific');
 await page.getByRole('button',{name:'开始撰写观察',exact:true}).click();
 const composer=page.locator('.live-composer-form');
 const option=composer.getByRole('checkbox',{name:'同时认可此人',exact:true});
 await option.waitFor();
 assert.equal(await option.isChecked(),false);
 await composer.getByRole('textbox').fill('先只发布观察。');
 await option.check();
 await composer.getByRole('button',{name:'收起',exact:true}).click();
 await page.getByRole('button',{name:'开始撰写观察',exact:true}).click();
 assert.equal(await composer.getByRole('textbox').inputValue(),'先只发布观察。');
 assert.equal(await option.isChecked(),false);
 await composer.getByRole('button',{name:'发布记录',exact:true}).click();
 await page.getByRole('tabpanel',{name:'全部动态',exact:true}).getByText('先只发布观察。',{exact:true}).waitFor();
 assert.equal((await api('/personnel-recognition/'+other.id)).quota.remaining,1);
 await page.getByRole('button',{name:'开始撰写观察',exact:true}).click();
 await composer.getByRole('textbox').fill('第二份样本观察，作为人员认可的依据。');
 await option.check();
 await page.screenshot({path:out+'/composer-320.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const attempts=[];
 await page.route('**/api/personnel-recognition/recognize',async route=>{
   attempts.push(route.request().postDataJSON());
   if(attempts.length===1){const response=await route.fetch();assert.equal(response.status(),200);await route.abort();}
   else await route.continue();
 });
 await composer.getByRole('button',{name:'发布记录',exact:true}).click();
 await page.getByText('观察已发布，认可未确认。',{exact:false}).waitFor();
 await page.getByRole('button',{name:'重试认可',exact:true}).click();
 await page.getByRole('button',{name:'重试认可',exact:true}).waitFor({state:'detached'});
 assert.equal(attempts.length,2);
 assert.deepEqual(attempts[0],attempts[1]);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM observations WHERE archive_id=?').get(other.id).n,2);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM personnel_recognitions WHERE observation_id=?').get(attempts[0].observation_id).n,1);
 assert.equal((await api('/personnel-recognition/'+other.id)).quota.remaining,0);
 await page.unroute('**/api/personnel-recognition/recognize');
 await toggle.click();
 await page.getByRole('button',{name:'撤回认可',exact:true}).click();
 await page.getByRole('button',{name:'确认撤回',exact:true}).click();
 await page.getByRole('dialog',{name:'撤回人员认可'}).waitFor({state:'detached'});
 await page.reload();
 await summary.getByText('0/3 人',{exact:true}).waitFor();
 assert.equal(await people.count(),0);
 await toggle.click();
 await records.getByText('已撤回',{exact:true}).waitFor();
 await createLink.click();
 const taskForm=page.getByRole('dialog',{name:'发布任务',exact:true});
 await taskForm.getByText('相关对象：虚构撤回记录',{exact:true}).waitFor();
 await taskForm.getByRole('textbox',{name:'标题',exact:true}).fill('档案关联任务验收');
 await taskForm.getByRole('textbox',{name:'要处理什么',exact:true}).fill('核对这份虚构档案的待办工作。');
 await taskForm.getByRole('textbox',{name:'交付要求',exact:true}).fill('记录结果。');
 await taskForm.getByText('调整接取期限',{exact:true}).click();
 assert.ok(await taskForm.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await page.screenshot({path:out+'/task-publish-320.png',fullPage:true});
 await taskForm.getByRole('button',{name:'发布任务',exact:true}).click();
 await taskForm.waitFor({state:'detached'});
 const relatedTasks=(await api('/work-tasks?archive_id='+other.id+'&state=open')).tasks;
 assert.equal(relatedTasks.length,1);
 await api('/work-tasks/cancel',{id:relatedTasks[0].id,expected_version:relatedTasks[0].version,reason:'验收关闭',request_id:uuid()});
 await page.setViewportSize({width:1440,height:1000});
 await page.goto(base+'/people?archive='+other.id);
 const countWithoutOpen=related.getByText('关联任务 0',{exact:true});
 const historyEntry=related.getByRole('button',{name:'查看已关闭任务',exact:true});
 await countWithoutOpen.waitFor();
 const zeroBox=await countWithoutOpen.boundingBox(), newBox=await createLink.boundingBox(), historyBox=await historyEntry.boundingBox();
 assert.ok(zeroBox&&newBox&&historyBox);
 assert.ok(Math.abs(zeroBox.y+zeroBox.height/2-historyBox.y-historyBox.height/2)<=1&&newBox.x>zeroBox.x&&historyBox.x>=newBox.x+newBox.width);
 await historyEntry.click();
 const history=page.getByRole('region',{name:'已关闭关联任务',exact:true});
 await history.getByText('档案关联任务验收',{exact:true}).waitFor();
 await history.getByRole('button',{name:'返回开启任务',exact:true}).click();
 await related.getByText('关联任务 0',{exact:true}).waitFor();
 // Existing task delivery remains the only route from review to onboarding to membership.
 let claim=await api('/work-tasks/claim',{id:third.task_id,expected_version:1,request_id:uuid()});let evidence=await api('/observations/create',{archive_id:a.id,body:'本轮审核有依据地确认通过。',request_id:uuid()});
 let delivered=await api('/work-tasks/complete',{id:third.task_id,expected_version:claim.version,result_kind:'audit_passed',result_text:'审核通过',references:[{observation_id:evidence.id,content_version:1}],request_id:uuid()});assert.equal(delivered.archive_status,'已加入待对接');
 await page.goto(base+'/people?archive='+a.id);
 await summary.getByText('上轮认可记录',{exact:true}).waitFor();
 assert.equal(await summary.getByRole('link',{name:'查看上轮审核任务',exact:true}).getAttribute('href'),'/tasks?task='+third.task_id);
 assert.equal(await bar.locator('.recognition-mark').count(),0);
 claim=await api('/work-tasks/claim',{id:delivered.next_task_id,expected_version:1,request_id:uuid()});evidence=await api('/observations/create',{archive_id:a.id,body:'已完成实际入社对接。',request_id:uuid()});
 delivered=await api('/work-tasks/complete',{id:claim.id,expected_version:claim.version,result_kind:'onboarding_completed',result_text:'对接完成',references:[{observation_id:evidence.id,content_version:1}],request_id:uuid()});assert.equal(delivered.membership_joined,true);
 assert.deepEqual(errors,[]);writeFileSync(out+'/result.json',JSON.stringify({passed:true,realHttp:true,realMcp:true,desktop:[1440,1000],mobile:[[390,844],[320,844]],contrastChecks,checks:['single-line desktop summaries with formal names and decoded authenticated avatars','recorded audit link survives vote withdrawal','expanded mobile record list and archive editor save','unchecked composer keeps quota','lost recognition response replays once','compact empty tasks and prefilled publication','web confirmation and monthly quota','MCP same rules and retry','third distinct member creates one unclaimed task','reference links open fixed versions','audit and onboarding deliveries reach membership','light/night contrast >= 4.5','no page errors'],errors},null,2));console.log('personnel-recognition: desktop summaries, authenticated avatars, web/MCP, evidence, mobile editor/publication and complete personnel lifecycle passed');
}catch(e){await page.screenshot({path:out+'/failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(-2000));throw e;}finally{await browser.close();await new Promise(r=>server.close(r));await Promise.allSettled(pending);f.close();}
