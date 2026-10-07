import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

function environment(){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/messages',pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','Event','CustomEvent','location','history','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{value:key==='window'?w:w[key],configurable:true,writable:true});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(f:()=>void)=>setTimeout(f,0)});
 const root=createRoot(w.document.getElementById('root')!);return {w,root,close:async()=>{await act(async()=>root.unmount());dom.window.close();}};
}

test('messages page reads and acknowledges only the selected message',async()=>{
 const f=environment(),calls:string[]=[];
 globalThis.fetch=async(url,options)=>{const path=String(url);calls.push(path);if(path==='/api/messages?limit=100')return Response.json({messages:[{id:'b880c0af-ddb4-4005-9e7e-8e9b0e48dac1',kind:'task_deadline_reminder',task_id:'task',title:'任务即将到期',body:'请提交结果',deadline_at:'2099-01-01T00:00:00Z',created_at:'2026-10-08T12:00:00Z',read:false,task_status:'open',archive_id:null,archive_name:null}]});if(path==='/api/messages/read'){assert.deepEqual(JSON.parse(String(options?.body)).ids,['b880c0af-ddb4-4005-9e7e-8e9b0e48dac1']);return Response.json({marked:1});}return Response.json({});};
 try{const {MessagesPage}=await import('../app/client/MessagesPage');await act(async()=>f.root.render(<MessagesPage/>));await new Promise(resolve=>setTimeout(resolve,20));const row=f.w.document.querySelector('.message-row') as HTMLButtonElement;assert.ok(row);await act(async()=>row.click());assert.ok(calls.includes('/api/messages/read'));assert.match(f.w.document.body.textContent??'',/任务即将到期/);}finally{await f.close();}
});
