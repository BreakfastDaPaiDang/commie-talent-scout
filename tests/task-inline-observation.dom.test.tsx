import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

for(const failure of ['lost-response','readback','forbidden'] as const)test(`inline observation ${failure}: preserves work and avoids duplicate publication on retry`,async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/tasks',pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','Event','CustomEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(w.document.getElementById('root')!),created:unknown[]=[],requests:Record<string,unknown>[]=[],busy:boolean[]=[];
 const observation={id:'saved-observation',archive_id:'archive',body:'本次联系结果',author_name:'负责人',created_at:'2026-11-05T10:00:00Z',content_version:1,deleted:false};let failed=false;
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/observations/create')){requests.push(JSON.parse(String(init?.body)));if(!failed&&(failure==='lost-response'||failure==='forbidden')){failed=true;if(failure==='lost-response')throw new TypeError('连接中断');return Response.json({error:{code:'ARCHIVE_CLOSED',message:'档案已关闭'}},{status:409});}return Response.json({id:observation.id,content_version:1});}
  if(String(url).includes('/commands/'))return Response.json({status:'completed',result:{id:observation.id,content_version:1}});
  if(failure==='readback'&&!failed){failed=true;throw new TypeError('读取超时');}
  return Response.json({observation});
 };
 try{
  const {TaskObservationComposer}=await import('../app/client/TaskObservationComposer');
  await act(async()=>root.render(<TaskObservationComposer archiveId="archive" initialBody={observation.body} onCreated={o=>created.push(o)} onBusyChange={b=>busy.push(b)}/>));
  const click=async(text:string)=>act(async()=>[...w.document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!.click());
  await click('记录本次观察');assert.equal(w.document.querySelector('textarea')?.value,observation.body);
  await click('保存到档案并引用');assert.equal(created.length,0);assert.ok(w.document.querySelector('[role=alert]'));
  if(failure==='forbidden'){assert.equal(w.document.querySelector('textarea')?.readOnly,false);assert.ok(w.document.body.textContent?.includes('档案已关闭'));}
  else{assert.equal(w.document.querySelector('textarea')?.readOnly,true);await click('重试保存并引用');assert.equal(requests.length,1);assert.deepEqual(created,[observation]);assert.equal(w.document.querySelector('textarea'),null);}
  assert.deepEqual(busy,failure==='forbidden'?[true,false]:[true,false,true,false]);assert.equal(requests[0].body,observation.body);assert.ok(requests[0].request_id);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
