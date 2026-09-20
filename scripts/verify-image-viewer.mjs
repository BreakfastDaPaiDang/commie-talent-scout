import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {preview} from 'vite';
import {chromium} from 'playwright-core';
import {fixture,archives,errors} from './ui-review-fixtures.mjs';
const server=await preview({preview:{host:'127.0.0.1',port:8794,strictPort:true}}),browser=await chromium.launch({channel:'msedge',headless:true});
const out='tmp/verification/image-viewer';mkdirSync(out,{recursive:true});
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="591" height="3109"><rect width="591" height="3109" fill="white"/>'+Array.from({length:70},(_,i)=>`<text x="30" y="${40+i*43}" font-size="22">第 ${i+1} 行：长截图阅读与缩放验收</text>`).join('')+'</svg>';
try{for(const width of [1440,390]){
 const context=await browser.newContext({viewport:{width,height:width===390?844:1000},hasTouch:width===390,isMobile:width===390}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>fixture({request:()=>route.request(),fulfill:options=>{for(const event of options.json?.events??[])if(event.observation)event.observation.attachments=[{id:'viewer-fixture',width:591,height:3109,mime_type:'image/png',byte_size:1000}];return route.fulfill(options);}}));
 await page.route('**/avatars/**',r=>r.fulfill({status:404,body:''}));await page.route('**/images/viewer-fixture',r=>r.fulfill({contentType:'image/svg+xml',body:svg}));
 await page.goto('http://127.0.0.1:8794/?archive='+archives[0].id,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'放大图片 1',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'查看原图'}),image=dialog.locator('img'),viewport=dialog.getByRole('region');await image.evaluate(i=>i.decode());
 const initial=await image.boundingBox(),view=await viewport.boundingBox();assert.ok(initial.width>view.width*.8,'long images initially fill the reading width');assert.ok(initial.height>view.height*1.5);assert.ok(Math.abs(initial.height/initial.width-3109/591)<.01);
 await dialog.getByRole('button',{name:'适应窗口',exact:true}).click();assert.ok((await image.boundingBox()).height<=view.height);
 await dialog.getByRole('button',{name:'原始尺寸',exact:true}).click();assert.ok(Math.abs((await image.boundingBox()).width-591)<1);
 await dialog.getByRole('button',{name:'放大图片',exact:true}).click();assert.ok((await image.boundingBox()).width>591);
 if(width===1440){await page.mouse.move(view.x+view.width/2,view.y+view.height*.7);await page.mouse.down();await page.mouse.move(view.x+view.width/2,view.y+view.height*.3,{steps:5});await page.mouse.up();assert.ok(await viewport.evaluate(e=>e.scrollTop)>100,'drag pans the enlarged image');}
 else{const cdp=await context.newCDPSession(page),x=view.x+view.width/2,y=view.y+view.height/2,before=(await image.boundingBox()).width;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-30,y,id:1},{x:x+30,y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-70,y,id:1},{x:x+70,y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(50);assert.ok((await image.boundingBox()).width>before*1.5,'two-finger pinch enlarges the image');}
 await dialog.getByRole('button',{name:'按宽度',exact:true}).click();await page.screenshot({path:`${out}/${width}.png`});assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});await context.close();
}assert.deepEqual(errors,[]);console.log(JSON.stringify({imageViewer:'passed',longImage:'591x3109',desktopDrag:true,mobilePinch:true}));}finally{await browser.close();await new Promise(resolve=>server.httpServer.close(resolve));}
