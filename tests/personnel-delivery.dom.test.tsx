import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

for(const [kind,result,label] of [['audit','audit_passed','审核通过'],['onboarding','onboarding_completed','对接完成']] as const)test(`${kind}: delivery requires an explicit conclusion and sends the selected observation`,async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/tasks',pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','Event','CustomEvent','location','history','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
 Object.assign(w.HTMLElement.prototype,{attachEvent(){},detachEvent(){}});w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(f:()=>void)=>setTimeout(f,0)});
 const root=createRoot(w.document.getElementById('root')!),actor={id:'00863713-2463-471a-925f-ad9c2f5eeb91',username:'fixture',name:'负责人',role:'member' as const,must_change_password:false,version:1,qq:null,avatar_id:null};
 const task={id:'b880c0af-ddb4-4005-9e7e-8e9b0e48dac1',archive_id:'c880c0af-ddb4-4005-9e7e-8e9b0e48dac1',source:'rule' as const,kind,title:'人事任务',purpose:'核对结果',delivery:'保留观察',status:'open' as const,owner_id:actor.id,created_by:actor.id,deadline_at:'2099-01-01T00:00:00Z',created_at:'2026-10-08T12:00:00Z',version:2,requires_observation_reference:true};
 let submitted:Record<string,unknown>|undefined,saved=0;
 globalThis.fetch=async(url,init)=>{
  if(String(url).includes('/observations?'))return Response.json({observations:[{id:'observation',content_version:3,author_name:'负责人',created_at:'2026-10-08T12:00:00Z',body:'已按实际完成审核或对接。'}],next_cursor:null});
  if(String(url).endsWith('/work-tasks/complete')){submitted=JSON.parse(String(init?.body));return Response.json({id:task.id,status:'completed'});}
  return Response.json({events:[],comments:[]});
 };
 try{
  const {TaskDetailModal}=await import('../app/client/WorkTasksPage');
  await act(async()=>root.render(<TaskDetailModal task={task} actor={actor} onClose={()=>{}} onChanged={()=>{saved++;}} onOpenArchive={()=>{}}/>));
  await act(async()=>[...w.document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='提交交付')!.click());
  const select=w.document.querySelector('.work-task-result select') as unknown as HTMLSelectElement;assert.equal(select.value,'');assert.equal(select.required,true);
  assert.ok([...select.options].some(o=>o.textContent===label));assert.equal([...select.options].some(o=>o.value==='completed'),false);
  await act(async()=>{select.value='unable_to_contact';select.dispatchEvent(new w.Event('change',{bubbles:true}));});
  assert.ok(w.document.body.textContent!.includes('保留档案当前人事阶段'));
  await act(async()=>{select.value=result;select.dispatchEvent(new w.Event('change',{bubbles:true}));});
  assert.ok(w.document.body.textContent!.includes(kind==='audit'?'默认期限 7 天':'保留原有资料与历史'));
  await act(async()=>w.document.querySelector<HTMLFormElement>('.work-task-result')!.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(submitted,undefined);assert.ok(w.document.body.textContent!.includes('请先在关联档案中记录观察'));
  await act(async()=>w.document.querySelector<HTMLInputElement>('.task-observation-option input')!.click());
  await act(async()=>w.document.querySelector<HTMLFormElement>('.work-task-result')!.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})));
  assert.equal(submitted!.result_kind,result);assert.deepEqual(submitted!.references,[{observation_id:'observation',content_version:3}]);assert.equal(saved,1);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
