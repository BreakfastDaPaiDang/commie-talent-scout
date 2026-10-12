import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import type {Archive} from '../app/server/archives';

test('member editor offers availability and explicit identity exits, with no personnel-state or close selector',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/members',pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','HTMLImageElement','Event','CustomEvent','location','history','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const root=createRoot(w.document.getElementById('root')!),oldFetch=globalThis.fetch,requests:Record<string,unknown>[]=[];
 globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/archives/state')){requests.push(JSON.parse(String(init?.body)));return Response.json({id:'fixture',changed:true});}return Response.json({members:[],next_cursor:null});};
 const {ArchiveStateForm}=await import('../app/client/ArchiveStateForm');
 const archive={id:'fixture',type:'person',status:'已入伙',person_role:'member',member_status:'可接工作',closed:false,version:1,members:[],bindings:{}} as unknown as Archive;
 try{
  await act(async()=>root.render(<ArchiveStateForm archive={archive} busy={false} setBusy={()=>{}} onSaved={async()=>{}} onReload={async()=>{}}/>));
  assert.deepEqual([...w.document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(e=>e.value),['可接工作','请假','失联']);
  assert.ok(!w.document.body.textContent?.includes('保存并关闭档案'));
  await act(async()=>w.document.querySelector<HTMLInputElement>('input[value="请假"]')!.click());
  await act(async()=>w.document.querySelector('form')!.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(requests.at(-1)?.member_status,'请假');assert.equal(requests.at(-1)?.status,'已入伙');assert.equal(requests.at(-1)?.membership_action,undefined);
  await act(async()=>{const select=w.document.querySelector('select')!;select.value='leave';select.dispatchEvent(new w.Event('change',{bubbles:true}));});
  assert.ok(w.document.body.textContent?.includes('确认退出组织'));
  await act(async()=>w.document.querySelector('form')!.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(requests.at(-1)?.membership_action,'leave');assert.equal(requests.at(-1)?.status,'已弃用');assert.equal(requests.at(-1)?.member_status,undefined);
 }finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;w.close();}
});
