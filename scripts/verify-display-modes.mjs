import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';

// Runs against the isolated real Worker/SQLite fixture, never production data.
export async function verifyDisplayModes({browser,page,context,base,taskId,archiveId,password,sqlite}){
 const out='tmp/verification/display-modes';mkdirSync(out,{recursive:true});
 const themeTokens=[...new Set(['app/ui','app/client'].flatMap(dir=>readdirSync(dir).filter(f=>f.endsWith('.css')).flatMap(f=>[...readFileSync(dir+'/'+f,'utf8').matchAll(/var\((--theme-[\w-]+)/g)].map(m=>m[1]))))];
 const colors={night:'rgb(27, 28, 29)',light:'rgb(246, 246, 246)'};
 async function selectTheme(target,mode){
  const button=target.getByRole('button',{name:/切换到(日间|深夜)模式/});await button.waitFor();
  if(await target.locator('html').getAttribute('data-theme')!==mode)await button.click();
  await target.waitForFunction(value=>document.documentElement.dataset.theme===value,mode);
  assert.equal(await button.getAttribute('aria-label'),mode==='night'?'切换到日间模式':'切换到深夜模式');
  assert.equal(await target.locator('.theme-picker select').count(),0);
 }
 async function check(mode){
  assert.equal(await page.locator('html').getAttribute('data-theme'),mode);
  if(mode!=='light')assert.deepEqual(await page.evaluate(tokens=>tokens.filter(t=>!getComputedStyle(document.documentElement).getPropertyValue(t).trim()),themeTokens),[],'all themed surfaces have a defined palette');
  assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),colors[mode]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const rects=await page.locator('.topbar .brand,.topbar .primary-nav>button,.topbar-tools button:visible,.topbar-tools summary:visible,.topbar>.theme-picker,.topbar>.icon-button:visible').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  assert.ok(rects.every(r=>r.left>=0&&r.right<=page.viewportSize().width),'header controls fit viewport');
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,'header controls must not overlap');}
 }
 for(const width of [1440,390])for(const mode of ['night']){
  await page.setViewportSize({width,height:1000});await page.goto(base+'/tasks?task='+taskId);
  await selectTheme(page,mode);await check(mode);
  await page.getByRole('button',{name:'提交交付',exact:true}).waitFor();await page.screenshot({path:out+'/'+mode+'-tasks-'+width+'.png',fullPage:true});
  await page.getByRole('button',{name:'提交交付',exact:true}).click();await page.getByRole('dialog',{name:'提交交付',exact:true}).waitFor();
  await page.getByLabel('结果说明',{exact:true}).fill('显示模式验证：填写结果说明，保留引用和原有提交操作。');
  const dialog=page.getByRole('dialog',{name:'提交交付',exact:true});
  assert.notEqual(await dialog.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await page.screenshot({path:out+'/'+mode+'-delivery-'+width+'.png',fullPage:true});await page.keyboard.press('Escape');
  await page.goto(base+'/?archive='+archiveId);await page.getByRole('button',{name:'编辑档案',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox',{name:'昵称',exact:true}).waitFor();await page.screenshot({path:out+'/'+mode+'-archive-editor-'+width+'.png',fullPage:true});
  await page.getByRole('dialog').locator('button').last().scrollIntoViewIfNeeded();await page.screenshot({path:out+'/'+mode+'-archive-editor-bottom-'+width+'.png',fullPage:true});await page.keyboard.press('Escape');
  await page.goto(base+'/statistics');await page.getByRole('heading',{name:'统计仪表盘',exact:true}).waitFor();await check(mode);await page.screenshot({path:out+'/'+mode+'-statistics-'+width+'.png',fullPage:true});
  await page.goto(base+'/tools/resources');await page.getByRole('button',{name:'＋ 新建资源',exact:true}).click();
  const name='主题验收-'+mode+'-'+width;await page.getByLabel('资源名称',{exact:true}).fill(name);await page.getByLabel('说明',{exact:true}).fill('验证主题切换不影响真实表单保存。');await page.screenshot({path:out+'/'+mode+'-resource-editor-'+width+'.png',fullPage:true});await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(sqlite.prepare('SELECT count(*) n FROM work_overview_resources WHERE name=?').get(name).n,1);
  await page.reload();await page.getByRole('heading',{name:'资源工具',exact:true}).waitFor();await check(mode);
 }
 for(const width of [375,768,1024,1201,1280]){await page.setViewportSize({width,height:1000});await page.goto(base+'/tasks');await selectTheme(page,'night');await check('night');await page.screenshot({path:out+'/night-header-'+width+'.png'});}
 // Approved archive layout: day/night share geometry; all records below are isolated fixtures.
 const owner=sqlite.prepare('SELECT created_by FROM work_tasks WHERE id=?').get(taskId).created_by;
 const sampleId=randomUUID(),sampleTask=randomUUID(),now=new Date().toISOString();
 sqlite.prepare("INSERT INTO archives(id,type,name,status,created_by,created_at,updated_at,contacts_json) VALUES(?,'person','沈舟（界面验收）','已加入待对接',?,?,?,?)").run(sampleId,owner,now,now,JSON.stringify([{type:'邮箱',value:'shenzhou@example.invalid',note:''},{type:'微信',value:'demo_shenzhou',note:''}]));
 sqlite.prepare("INSERT INTO work_tasks(id,archive_id,kind,title,purpose,delivery,source,owner_id,deadline_at,created_by,created_at,updated_at) VALUES(?,?,'custom','安排首次项目交流','确认参与意愿','记录沟通结果','manual',?,'2098-12-01T12:00:00Z',?,?,?)").run(sampleTask,sampleId,owner,owner,now,now);
 const geometry={};
 for(const width of [1440,390])for(const mode of ['light','night']){
  await page.setViewportSize({width,height:1000});await page.goto(base+'/?archive='+sampleId);await selectTheme(page,mode);
  await page.locator('.entity-heading h1').filter({hasText:'沈舟'}).waitFor();
  assert.equal(await page.locator('.entity-heading .state-badge').innerText(),'待对接');
  assert.equal(await page.locator('.detail-top').innerText(),'分享');
  const edit=page.getByRole('button',{name:'编辑档案',exact:true});assert.equal(await edit.innerText(),'');
  assert.ok((await edit.boundingBox()).width>=44);assert.equal(await edit.locator('svg').evaluate(el=>el.getBoundingClientRect().width),30);
  const task=page.locator('.related-tasks .compact').filter({hasText:'安排首次项目交流'});await task.waitFor();
  assert.equal(await task.getByRole('img',{name:'进行中',exact:true}).count(),1);assert.equal(await task.getByText('进行中',{exact:true}).count(),0);
  assert.equal(await page.locator('.related-tasks header').innerText(),'查看已关闭任务');
  await task.click();await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('dialog').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await page.keyboard.press('Escape');
  await page.locator('.entity-heading h1').click();await page.locator('.detail-scroll').evaluate(el=>el.scrollTop=0);
  geometry[width+'-'+mode]=await page.locator('.detail-top,.entity-heading h1,.archive-edit-entry,.detail-panel').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));
  await page.screenshot({path:out+'/'+mode+'-archive-'+width+'.png',fullPage:true});
  const body='已联系：近期在学习写作，希望先参与一次选题讨论。'+width+'-'+mode;
  await page.getByRole('textbox',{name:'新的观察记录',exact:true}).fill(body);await page.getByRole('button',{name:'发布记录',exact:true}).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:out+'/'+mode+'-observation-publish-'+width+'.png',fullPage:true});
  await page.getByRole('button',{name:'发布记录',exact:true}).click();await page.locator('.record-body').filter({hasText:body}).waitFor();
  assert.equal(sqlite.prepare('SELECT count(*) n FROM observations o JOIN observation_versions v ON v.observation_id=o.id AND v.version=o.content_version WHERE o.archive_id=? AND v.body=?').get(sampleId,body).n,1);
  if(width<600)await page.getByRole('button',{name:'关闭档案详情',exact:true}).click();
  const footer=page.locator('.archive-list-footer');await footer.waitFor();
  assert.equal(await page.getByRole('combobox',{name:'已关闭档案',exact:true}).count(),1);
  assert.equal(await page.locator('.list-toolbar .closed-history-filter,.filter-summary').count(),0);
  const before=await footer.boundingBox();assert.ok(Math.abs(before.y+before.height-1000)<2,'closed archive range is at the viewport bottom');
  await page.locator('.archive-list-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
  assert.deepEqual(await footer.boundingBox(),before,'footer stays fixed when the archive list scrolls');
  const range=page.getByRole('combobox',{name:'已关闭档案',exact:true});await Promise.all([page.waitForResponse(r=>r.url().includes('/api/archives?')&&new URL(r.url()).searchParams.get('closed_history')==='all'),range.selectOption('all')]);
  await page.screenshot({path:out+'/'+mode+'-archive-list-'+width+'.png',fullPage:true});await range.selectOption('30');
 }
 for(const width of [1440,390])for(let i=0;i<geometry[width+'-light'].length;i++)for(let j=0;j<4;j++)assert.ok(Math.abs(geometry[width+'-light'][i][j]-geometry[width+'-night'][i][j])<1,'day/night archive layout is identical');
 // Cross-tab synchronization and keyboard operation.
 const tab=await context.newPage();await tab.goto(base+'/agent');await tab.getByRole('button',{name:/切换到(日间|深夜)模式/}).waitFor();
 await selectTheme(page,'light');await tab.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 await selectTheme(tab,'night');await page.waitForFunction(()=>document.documentElement.dataset.theme==='night');
 await page.getByRole('button',{name:'切换到日间模式'}).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await check('light');await page.keyboard.press('Space');await page.waitForFunction(()=>document.documentElement.dataset.theme==='night');await tab.close();
 // Login, same target after signing in, and shared prototype palette.
 const receiver=await browser.newContext({viewport:{width:390,height:844}}),login=await receiver.newPage();
 await login.goto(base+'/tasks?task='+taskId);await selectTheme(login,'night');await login.reload();await login.locator('input[name=password]').waitFor();assert.equal(await login.locator('html').getAttribute('data-theme'),'night');await login.screenshot({path:out+'/night-login-390.png',fullPage:true});
 await login.locator('input[name=username]').fill('fixture');await login.locator('input[name=password]').fill(password);await login.getByRole('button',{name:'登录',exact:true}).click();await login.getByRole('button',{name:'提交交付',exact:true}).waitFor();assert.equal(await login.locator('html').getAttribute('data-theme'),'night');assert.equal(new URL(login.url()).searchParams.get('task'),taskId);await receiver.close();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5196/');await selectTheme(page,'night');await page.screenshot({path:out+'/night-shared-prototype-'+width+'.png',fullPage:true});assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),colors.night);
 }
 // Storage denial must not prevent switching or mounting the app.
 const denied=await browser.newContext();await denied.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}}));const restricted=await denied.newPage();await restricted.goto(base);await selectTheme(restricted,'night');assert.equal(await restricted.locator('html').getAttribute('data-theme'),'night');await denied.close();
 // An obsolete eye-care preference returns to light before application JS loads.
 const legacyContext=await browser.newContext(),legacy=await legacyContext.newPage();await legacy.addInitScript(()=>localStorage.setItem('cts-display-mode','care'));await legacy.route('**/assets/*.js',r=>r.abort());await legacy.goto(base);assert.equal(await legacy.locator('html').getAttribute('data-theme'),'light');assert.equal(await legacy.evaluate(()=>localStorage.getItem('cts-display-mode')),'light');await legacyContext.close();
 // Synchronous restoration still works while the application JS is unavailable.
 await page.goto(base);await selectTheme(page,'night');
 const early=await context.newPage();await early.route('**/assets/*.js',r=>r.abort());await early.goto(base);assert.equal(await early.locator('html').getAttribute('data-theme'),'night');assert.equal(await early.locator('html').evaluate(el=>el.style.colorScheme),'dark');await early.close();
 await selectTheme(page,'light');
 writeFileSync(out+'/result.json',JSON.stringify({passed:true,realHttp:true,modes:['light','night'],widths:[1440,390],checks:['shared day/night geometry; bottom range selection and scroll; pencil and compact status; real observation publication','complete delivery/archive/resource forms','real save and reload','cross-tab sync','keyboard','login target retention','shared prototype','storage denied','pre-render restoration','no horizontal overflow']},null,2));
 console.log('display-modes: desktop/mobile, real HTTP, persistence and shared prototype passed');
}
