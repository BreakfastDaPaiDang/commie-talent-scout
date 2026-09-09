import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';

test('periodic alarm refresh preserves loaded pages and pauses while an actual editor holds unsaved input',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','HTMLImageElement','Event','CustomEvent','location','history','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});Object.defineProperty(w.document,'visibilityState',{value:'visible',configurable:true});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const {createRoot}=await import('react-dom/client');
 const {ArchivesPage}=await import('../app/client/ArchivesPage');
 const oldFetch=globalThis.fetch,oldInterval=globalThis.setInterval,requests:string[]=[],root=createRoot(w.document.getElementById('root')!);let refresh=()=>{},phase=0;
 globalThis.setInterval=((callback:()=>void,delay:number)=>{if(delay===60000){refresh=callback;return oldInterval(()=>{},86400000);}return oldInterval(callback,delay);}) as typeof setInterval;
 const rows=Array.from({length:35},(_,i)=>({id:`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`,type:'person',name:'虚构待检查 '+i,status:'视奸观察',closed:false,deleted:false,version:1,contacts:[],links:[],members:[],bindings:{},tags:[],avatar_id:null,observation_count:0,updated_at:'2026-09-01T00:00:00.000Z',tag_summary:{tags:[],total:0},unread_count:1,update_reminder:{overdue:false,threshold_days:30,due_at:'2026-10-01T00:00:00.000Z'}}));
 globalThis.fetch=async url=>{const path=String(url);if(path.startsWith('/api/archives?')){requests.push(path);const q=new URL(path,'http://localhost').searchParams,limit=Number(q.get('limit')??30),start=q.has('before')?30:0,data=phase?[{...rows[34],update_reminder:{...rows[34].update_reminder,overdue:true}},...rows.slice(0,34)]:rows;return Response.json({archives:data.slice(start,start+limit),counts:{all:35,mine:0,unread:35},next_cursor:start+limit<35?'next':null});}if(path.startsWith('/api/members'))return Response.json({members:[],next_cursor:null});if(path==='/api/drafts')return Response.json({drafts:[]});throw new Error(path);};
 const actor={id:'20000000-0000-4000-8000-000000000001',username:'fixture',name:'虚构成员',role:'member' as const,must_change_password:false,version:1,qq:null,avatar_id:null};
 const click=async(text:string)=>act(async()=>{[...w.document.querySelectorAll('button')].find(b=>b.textContent===text)!.click();});
 try{
  await act(async()=>root.render(<ArchivesPage actor={actor} type="person"/>));await act(async()=>new Promise(r=>setTimeout(r,300)));assert.equal(w.document.querySelectorAll('.entity-row').length,30);await click('加载更多档案');assert.equal(w.document.querySelectorAll('.entity-row').length,35);
  await click('新建');const input=w.document.querySelector<HTMLInputElement>('dialog input[name="name"]')??w.document.querySelector<HTMLInputElement>('dialog input');assert.ok(input);input.value='未保存的新档案';const count=requests.length;
  phase=1;await act(async()=>refresh());assert.equal(requests.length,count);assert.equal(input.value,'未保存的新档案');
  await act(async()=>w.document.querySelector<HTMLButtonElement>('dialog button[aria-label="关闭对话框"]')!.click());await act(async()=>refresh());assert.equal(w.document.querySelectorAll('.entity-row').length,35);assert.equal(new URL(requests.at(-1)!,'http://localhost').searchParams.get('limit'),'35');assert.match(w.document.querySelector('.entity-row')!.textContent!,/需更新或关闭/);assert.ok(w.document.querySelector('.entity-row .row-unread'));
  Object.defineProperty(w.document,'visibilityState',{value:'hidden'});const n=requests.length;await act(async()=>refresh());assert.equal(requests.length,n);
 }finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;globalThis.setInterval=oldInterval;dom.window.close();}
});
