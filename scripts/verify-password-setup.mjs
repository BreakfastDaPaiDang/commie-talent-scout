import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';
import {verificationClient} from './verification-client.mjs';
const v=await verificationClient('password-setup'),checks=[];
const username='password-ui-'+randomUUID().slice(0,8),temporary=randomUUID()+randomUUID(),next=randomUUID()+randomUUID();
let member,browser;
try{
 const created=await v.http('/admin/members/create',{username,name:'虚构首次改密验收',temporary_password:temporary,request_id:randomUUID()});assert.equal(created.status,200);member=created.body;
 browser=await chromium.launch({channel:process.env.CTS_TEST_BROWSER??'msedge',headless:true});
 const context=await browser.newContext(),page=await context.newPage();
 // An optional local build uses the real staging APIs through a test-only route.
 const ui=process.env.CTS_UI_BASE??v.base;
 if(ui!==v.base)await page.route('**/api/**',async route=>{const req=route.request(),url=v.base+new URL(req.url()).pathname+new URL(req.url()).search;const response=await context.request.fetch(url,{method:req.method(),headers:{Origin:v.base,'Content-Type':'application/json'},...(req.postData()?{data:req.postData()}:{})});await route.fulfill({response});});
 await page.goto(ui+'/');await page.getByRole('form',{name:'登录'}).waitFor();
 mkdirSync('tmp/verification/password-input',{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));const fields=await page.locator('[name="username"],[name="password"]').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));assert.ok(Math.abs(fields[0]-fields[1])<1,'password field keeps the full login form width');await page.screenshot({path:'tmp/verification/password-input/'+width+'.png'});}
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('[name="password"]').fill('synthetic-visible-check');await page.getByRole('button',{name:'显示密码',exact:true}).click();assert.equal(await page.locator('[name="password"]').getAttribute('type'),'text');assert.equal(await page.locator('[name="password"]').inputValue(),'synthetic-visible-check');await page.getByRole('button',{name:'隐藏密码',exact:true}).click();
 checks.push('shared password visibility preserves input and fits desktop/mobile login layouts');
 await page.locator('[name="username"]').fill(username);await page.locator('[name="password"]').fill(temporary);await page.getByRole('button',{name:'登录',exact:false}).click();
 await page.getByRole('heading',{name:'设置你的密码'}).waitFor();
 await page.locator('[name="current_password"]').fill(temporary);await page.locator('[name="new_password"]').fill(next);await page.locator('[name="confirm_password"]').fill(next);
 await page.getByRole('button',{name:'保存新密码',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('button[disabled]')?.textContent?.includes('正在保存'));
 await page.getByRole('button',{name:'人物',exact:true}).waitFor({timeout:8000});
 checks.push('first password setup automatically opens the actual workspace without returning to the login form');
 const health=await context.request.get(v.base+'/api/workspace');assert.equal(health.status(),200);
 const old=await context.request.post(v.base+'/api/auth/login',{headers:{Origin:v.base},data:{username,password:temporary}});assert.equal(old.status(),401);
 checks.push('new session can use workspace and the old temporary password is rejected');
 await context.clearCookies();await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await page.getByRole('form',{name:'登录'}).waitFor();assert.equal(await page.locator('[name="password"]').inputValue(),'');
 await page.locator('[name="username"]').fill(username);await page.locator('[name="password"]').fill(next);await page.getByRole('button',{name:'登录',exact:false}).click();await page.getByRole('button',{name:'人物',exact:true}).waitFor();
 checks.push('a restored page with an expired browser session returns to a fresh login form and can authenticate again');
 // Simulate a failed automatic login after a second, successfully saved password change.
 await page.goto(ui+'/account/password');await page.getByRole('form',{name:'修改密码'}).waitFor();
 const last=randomUUID()+randomUUID();await page.locator('[name="current_password"]').fill(next);await page.locator('[name="new_password"]').fill(last);await page.locator('[name="confirm_password"]').fill(last);
 await page.route('**/api/auth/login',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEMPORARY_FAILURE',message:'模拟登录暂不可用'}})}));
 await page.getByRole('button',{name:'保存新密码',exact:true}).click();await page.getByRole('form',{name:'登录'}).waitFor();
 assert.match(await page.getByRole('alert').innerText(),/密码已保存/);assert.equal(await page.locator('[name="username"]').inputValue(),username);assert.equal(await page.locator('[name="password"]').inputValue(),'');
 checks.push('successful save plus failed automatic login is clearly distinguished, with username retained and password cleared');
}finally{
 if(browser)await browser.close();
 if(member){const current=(await v.http('/admin/members/'+member.id)).body.member;await v.http('/admin/members/frozen',{id:member.id,expected_version:current.version,frozen:true,request_id:randomUUID()});}
 await v.close(checks);
}
