import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {MaterialsSection} from '../app/client/MaterialsSection';

test('switching material scopes removes stale rows until the new list arrives',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','Event','location'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(w.document.getElementById('root')!),oldFetch=globalThis.fetch;let resolveTrash:(r:Response)=>void=()=>{};
 const capacity={used_bytes:1,limit_bytes:100000000,reserved_bytes:0,count:1},file={id:'file',name:'现有材料.txt',owner_name:'虚构成员',byte_size:1,created_at:'2026-09-09T00:00:00Z',state:'ready',deleted:false,version:1,editable:true};
 globalThis.fetch=async url=>String(url).includes('deleted=true')?new Promise<Response>(resolve=>{resolveTrash=resolve;}):Response.json({materials:[file],capacity,next_cursor:null});
 const actor={id:'actor',username:'fixture',name:'虚构成员',role:'member' as const,must_change_password:false,version:1,qq:null,avatar_id:null},archive={id:'archive',closed:false,deleted:false,version:1} as React.ComponentProps<typeof MaterialsSection>['archive'];
 try{await act(async()=>root.render(<MaterialsSection actor={actor} archive={archive} active onChanged={()=>{}}/>));assert.ok(w.document.querySelector('.material-row'));
  await act(async()=>{[...w.document.querySelectorAll('button')].find(b=>b.textContent==='回收站')!.click();});assert.equal(w.document.querySelector('.material-row'),null);assert.match(w.document.body.textContent!,/正在读取材料/);
  await act(async()=>resolveTrash(Response.json({materials:[{...file,deleted:true,version:3}],capacity,next_cursor:null})));assert.ok(w.document.querySelector('.material-row'));assert.match(w.document.body.textContent!,/恢复材料/);
 }finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;dom.window.close();}
});
