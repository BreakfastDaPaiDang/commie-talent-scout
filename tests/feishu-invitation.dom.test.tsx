import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

test('joining notice deduplicates a command, expires while open and never renders the old QR after expiry',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','Event','CustomEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const originalNow=Date.now;let now=Date.parse('2026-12-20T23:59:59+08:00');Date.now=()=>now;
 const root=createRoot(w.document.getElementById('root')!);
 try{
  const {MembershipNotice,notifyMembershipJoined}=await import('../app/client/MembershipNotice');
  await act(async()=>root.render(<MembershipNotice/>));
  await act(async()=>notifyMembershipJoined({},'not-joined'));assert.equal(w.document.querySelector('dialog'),null);
  await act(async()=>notifyMembershipJoined({membership_joined:true},'joined'));assert.ok(w.document.querySelector('.feishu-qr image'));assert.match(w.document.body.textContent!,/入职成功，请引入飞书/);
  now=Date.parse('2026-12-21T00:00:00+08:00');await act(async()=>w.document.dispatchEvent(new w.Event('visibilitychange')));assert.equal(w.document.querySelector('.feishu-qr'),null);assert.match(w.document.body.textContent!,/已经过期，找神棍和散言更新/);
  await act(async()=>[...w.document.querySelectorAll('button')].find(b=>b.textContent==='知道了')!.click());assert.equal(w.document.querySelector('dialog'),null);
  await act(async()=>notifyMembershipJoined({membership_joined:true},'joined'));assert.equal(w.document.querySelector('dialog'),null);
  await act(async()=>notifyMembershipJoined({membership_joined:true},'another-person'));assert.ok(w.document.querySelector('dialog'));assert.equal(w.document.querySelector('image'),null);
 }finally{await act(async()=>root.unmount());Date.now=originalNow;dom.window.close();}
});
