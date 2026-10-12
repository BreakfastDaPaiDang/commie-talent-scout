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
 globalThis.fetch=async(url,options)=>{const path=String(url);calls.push(path);if(path==='/api/notifications?source=task&limit=100')return Response.json({snapshot:'snapshot',next_cursor:null,notifications:[{source:'task',read:false,data:{id:'b880c0af-ddb4-4005-9e7e-8e9b0e48dac1',kind:'task_deadline_reminder',task_id:'task',title:'任务即将到期',body:'请提交结果',deadline_at:'2099-01-01T00:00:00Z',created_at:'2026-10-08T12:00:00Z',read:false,task_status:'open',archive_id:null,archive_name:null}}]});if(path==='/api/notifications/confirm'){assert.deepEqual(JSON.parse(String(options?.body)).ids,['task:b880c0af-ddb4-4005-9e7e-8e9b0e48dac1']);return Response.json({marked:1});}return Response.json({});};
 try{const {MessagesPage}=await import('../app/client/MessagesPage');await act(async()=>f.root.render(<MessagesPage/>));await new Promise(resolve=>setTimeout(resolve,20));const row=f.w.document.querySelector('.message-row') as HTMLButtonElement;assert.ok(row);await act(async()=>row.click());assert.ok(calls.includes('/api/notifications/confirm'));assert.match(f.w.document.body.textContent??'',/任务即将到期/);}finally{await f.close();}
});

test('unified inbox does not auto-open, navigates back to list, and all-read keeps history pagination',async()=>{
 const f=environment(),confirmations:unknown[]=[],actor={id:'00863713-2463-471a-925f-ad9c2f5eeb91',username:'reader',name:'读者',role:'member' as const,must_change_password:false,version:1,qq:null,avatar_id:null};
 const task={id:'task:b880c0af-ddb4-4005-9e7e-8e9b0e48dac1',source:'task',created_at:'2026-10-12T11:00:00Z',read:false,data:{id:'b880c0af-ddb4-4005-9e7e-8e9b0e48dac1',kind:'task_overdue',title:'任务已逾期',task_id:'task',body:'请如实处理',archive_id:null}},archive={id:'archive:e',source:'archive',created_at:'2026-10-12T10:00:00Z',read:false,data:{id:'e',seq:1,kind:'archive.created',type:'person',archive_id:'archive',archive_name:'消息对象',actor_id:'writer',actor_name:'作者'}};
 globalThis.fetch=async(url,options)=>{const path=String(url);if(path.startsWith('/api/notifications?'))return Response.json({notifications:path.includes('cursor=next')?[]:[task,archive],snapshot:'snapshot',next_cursor:path.includes('cursor=next')?null:'next'});if(path==='/api/notifications/confirm'){confirmations.push(JSON.parse(String(options?.body)));return Response.json({marked:2});}return Response.json({});};
 const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
 try{const {NotificationCenter}=await import('../app/client/NotificationCenter');await act(async()=>f.root.render(<NotificationCenter actor={actor} onNavigate={()=>{}}/>));await settle();assert.equal(confirmations.length,0);assert.equal(f.w.document.querySelectorAll('.inbox-list .update-row').length,2);assert.equal(f.w.document.querySelector('.notification-detail'),null);
 await act(async()=>(f.w.document.querySelector('.inbox-list .update-row') as HTMLButtonElement).click());await settle();assert.equal(f.w.location.search,'?notification='+encodeURIComponent(task.id));assert.ok(f.w.document.querySelector('.notification-detail'));assert.deepEqual(confirmations,[{mode:'message',ids:[task.id]}]);
 await act(async()=>{f.w.history.back();});await settle();assert.equal(f.w.location.pathname,'/messages');assert.equal(f.w.document.querySelector('.notification-detail'),null);
 const all=[...f.w.document.querySelectorAll('button')].find(b=>b.textContent==='全部标为已读')!;await act(async()=>all.click());await settle();assert.deepEqual(confirmations.at(-1),{mode:'all',snapshot:'snapshot'});assert.equal(f.w.document.querySelectorAll('.inbox-list .update-row.read').length,2);assert.equal(all.disabled,true);assert.ok([...f.w.document.querySelectorAll('button')].some(b=>b.textContent==='加载更多消息'));
 }finally{await f.close();}
});
