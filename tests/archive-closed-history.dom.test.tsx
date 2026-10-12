import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
const actor={id:'20000000-0000-4000-8000-000000000001',username:'fixture',name:'虚构管理员',role:'admin' as const,must_change_password:false,version:1,qq:null,avatar_id:null};

test('archive ranges default to 30, persist per page, reset to 30 and leave deleted archives unrestricted',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','HTMLImageElement','Event','CustomEvent','location','history','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
 const {ArchivesPage}=await import('../app/client/ArchivesPage');
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const root=createRoot(w.document.getElementById('root')!),requests:URL[]=[],oldFetch=globalThis.fetch;
 globalThis.fetch=async url=>{const u=new URL(String(url),'http://localhost');if(u.pathname==='/api/archives'){requests.push(u);return Response.json({archives:[],counts:{all:0,mine:0,unread:0},next_cursor:null});}return Response.json({members:[],tags:[],drafts:[],next_cursor:null});};
 const click=async(text:string)=>act(async()=>{[...w.document.querySelectorAll('button')].find(b=>b.textContent===text)!.click();});
 const choose=async(value:string)=>act(async()=>{const s=w.document.querySelector('select[aria-label="已关闭档案"]') as unknown as HTMLSelectElement;s.value=value;s.dispatchEvent(new w.Event('change',{bubbles:true}));});
 try{
  for(const [key,type,scope] of [['外部人物','person','external'],['社员','person','members'],['组织','org','all']] as const){
   await act(async()=>root.render(<ArchivesPage key={key} actor={actor} pageLabel={key} type={type} personScope={scope}/>));
   assert.equal(requests.at(-1)!.searchParams.get('closed_history'),'30');assert.equal(requests.at(-1)!.searchParams.get('person_scope'),scope);
   assert.equal(w.document.querySelector('.filter-summary')!.textContent,'已关闭档案：最近 30 天');
   await click('已关闭档案：最近 30 天');await choose('90');assert.equal(requests.at(-1)!.searchParams.get('closed_history'),'90');
   await click('筛选');assert.equal(w.document.querySelector('.filter-summary')!.textContent,'已关闭档案：最近 90 天');
   await click('筛选');await choose('all');assert.equal(requests.at(-1)!.searchParams.get('closed_history'),'all');
   await click('重置筛选');assert.equal(requests.at(-1)!.searchParams.get('closed_history'),'30');
   await choose('90');
  }
  await act(async()=>root.render(<ArchivesPage key="back" actor={actor} type="person" personScope="external" pageLabel="外部人物"/>));
  assert.equal(requests.at(-1)!.searchParams.get('closed_history'),'90','returning to a page restores its own preference');
  await act(async()=>root.render(<ArchivesPage key="trash" actor={actor} type="person" trash/>));
  assert.equal(requests.at(-1)!.searchParams.get('closed_history'),'all');assert.equal(w.document.querySelector('.filter-summary'),null);
 }finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;dom.window.close();}
});
