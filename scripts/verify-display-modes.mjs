import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';

// Runs against the isolated real Worker/SQLite fixture, never production data.
export async function verifyDisplayModes({browser,page,context,base,taskId,archiveId,password,sqlite}){
 const out='tmp/verification/display-modes';mkdirSync(out,{recursive:true});
 const themeTokens=[...new Set(['app/ui','app/client'].flatMap(dir=>readdirSync(dir).filter(f=>f.endsWith('.css')).flatMap(f=>[...readFileSync(dir+'/'+f,'utf8').matchAll(/var\((--theme-[\w-]+)/g)].map(m=>m[1]))))];
 const colors={night:'rgb(24, 27, 29)',care:'rgb(238, 230, 213)',light:'rgb(246, 246, 246)'};
 async function check(mode){
  assert.equal(await page.locator('html').getAttribute('data-theme'),mode);
  if(mode!=='light')assert.deepEqual(await page.evaluate(tokens=>tokens.filter(t=>!getComputedStyle(document.documentElement).getPropertyValue(t).trim()),themeTokens),[],'all themed surfaces have a defined palette');
  assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),colors[mode]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const rects=await page.locator('.topbar .brand,.topbar .primary-nav>button,.topbar-tools button:visible,.topbar-tools summary:visible,.topbar>.theme-picker,.topbar>.icon-button:visible').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  assert.ok(rects.every(r=>r.left>=0&&r.right<=page.viewportSize().width),'header controls fit viewport');
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top,'header controls must not overlap');}
 }
 for(const width of [1440,390])for(const mode of ['night','care']){
  await page.setViewportSize({width,height:1000});await page.goto(base+'/tasks?task='+taskId);
  await page.getByLabel('显示模式',{exact:true}).selectOption(mode);await check(mode);
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
 for(const width of [375,768,1024,1201,1280]){await page.setViewportSize({width,height:1000});await page.goto(base+'/tasks');await page.getByLabel('显示模式',{exact:true}).waitFor();await check('care');await page.screenshot({path:out+'/care-header-'+width+'.png'});}
 // Cross-tab synchronization and keyboard operation.
 const tab=await context.newPage();await tab.goto(base+'/agent');await tab.getByLabel('显示模式',{exact:true}).waitFor();
 await page.getByLabel('显示模式',{exact:true}).selectOption('night');await tab.waitForFunction(()=>document.documentElement.dataset.theme==='night');
 await tab.getByLabel('显示模式',{exact:true}).selectOption('care');await page.waitForFunction(()=>document.documentElement.dataset.theme==='care');
 await page.getByLabel('显示模式',{exact:true}).focus();await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await check('light');await tab.close();
 // Login, same target after signing in, and shared prototype palette.
 const receiver=await browser.newContext({viewport:{width:390,height:844}}),login=await receiver.newPage();
 await login.goto(base+'/tasks?task='+taskId);await login.getByLabel('显示模式',{exact:true}).selectOption('night');await login.reload();await login.locator('input[name=password]').waitFor();assert.equal(await login.locator('html').getAttribute('data-theme'),'night');await login.screenshot({path:out+'/night-login-390.png',fullPage:true});
 await login.locator('input[name=username]').fill('fixture');await login.locator('input[name=password]').fill(password);await login.getByRole('button',{name:'登录',exact:true}).click();await login.getByRole('button',{name:'提交交付',exact:true}).waitFor();assert.equal(await login.locator('html').getAttribute('data-theme'),'night');assert.equal(new URL(login.url()).searchParams.get('task'),taskId);await receiver.close();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:5196/');await page.getByLabel('显示模式',{exact:true}).selectOption('night');await page.screenshot({path:out+'/night-shared-prototype-'+width+'.png',fullPage:true});assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),colors.night);
 }
 // Storage denial must not prevent switching or mounting the app.
 const denied=await browser.newContext();await denied.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError');}}));const restricted=await denied.newPage();await restricted.goto(base);await restricted.getByLabel('显示模式',{exact:true}).selectOption('care');assert.equal(await restricted.locator('html').getAttribute('data-theme'),'care');await denied.close();
 // Synchronous restoration still works while the application JS is unavailable.
 await page.goto(base);await page.getByLabel('显示模式',{exact:true}).selectOption('night');
 const early=await context.newPage();await early.route('**/assets/*.js',r=>r.abort());await early.goto(base);assert.equal(await early.locator('html').getAttribute('data-theme'),'night');assert.equal(await early.locator('html').evaluate(el=>el.style.colorScheme),'dark');await early.close();
 await page.getByLabel('显示模式',{exact:true}).selectOption('light');
 writeFileSync(out+'/result.json',JSON.stringify({passed:true,realHttp:true,modes:['light','night','care'],widths:[1440,390],checks:['complete delivery/archive/resource forms','real save and reload','cross-tab sync','keyboard','login target retention','shared prototype','storage denied','pre-render restoration','no horizontal overflow']},null,2));
 console.log('display-modes: desktop/mobile, real HTTP, persistence and shared prototype passed');
}
