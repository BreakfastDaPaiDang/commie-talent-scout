import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

const id='b880c0af-ddb4-4005-9e7e-8e9b0e48dac1';
const actor={id:'00863713-2463-471a-925f-ad9c2f5eeb91',username:'fixture',name:'管理员',role:'admin' as const,must_change_password:false,version:1,qq:null,avatar_id:null};
const archive={id,type:'person' as const,name:'任务对象',status:'个人接触',version:2,updated_at:'2026-10-08T12:00:00Z',observation_count:2,latest_observation:'最近观察',members:[],tag_summary:{tags:[],total:0}};
const task={id,archive_id:archive.id,archive_preview:archive,kind:'custom' as const,title:'核对任务',purpose:'确认当前进展',delivery:'写回结果',status:'open' as const,owner_id:actor.id,owner_name:actor.name,owner_version:actor.version,created_by:actor.id,deadline_at:'2099-01-01T00:00:00Z',created_at:'2026-10-08T12:00:00Z',version:3};
function environment(){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/tasks?task='+id,pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','Event','CustomEvent','location','history','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
 // React was imported before JSDOM; emulate its legacy focus-tracking hooks.
 Object.assign(w.HTMLElement.prototype,{attachEvent(){},detachEvent(){}});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(f:()=>void)=>setTimeout(f,0)});
 const root=createRoot(w.document.getElementById('root')!);
 return {dom,w,root,async close(){await act(async()=>root.unmount());dom.window.close();}};
}

test('related tasks page through all owners and ignore a late open-list response after switching to history',async()=>{
 const f=environment(),requests:string[]=[];let resolveOpen:(value:Response)=>void=()=>{};
 globalThis.fetch=async url=>{const path=String(url);requests.push(path);if(path.includes('state=open'))return new Promise<Response>(resolve=>resolveOpen=resolve);return Response.json({tasks:[{...task,id:'closed',title:'关闭的任务',status:'cancelled'}],next_offset:null});};
 try{
  const {ArchiveTasks}=await import('../app/client/ArchiveTasks');await act(async()=>f.root.render(<ArchiveTasks archiveId={id} archiveVersion={1} actor={actor} onChanged={()=>{}} onOpenArchive={()=>{}}/>));
  assert.ok(requests[0].includes('scope=all'));assert.ok(requests[0].includes('archive_id='+id));
  await act(async()=>[...f.w.document.querySelectorAll('button')].find(b=>b.textContent==='查看已关闭任务')!.click());
  await act(async()=>resolveOpen(Response.json({tasks:[task],next_offset:null})));
  assert.equal(f.w.document.querySelectorAll('.task-list-row').length,1);assert.ok(f.w.document.body.textContent!.includes('关闭的任务'));assert.ok(!f.w.document.body.textContent!.includes('核对任务'));
 }finally{await f.close();}
});

test('related tasks pagination can retry a failed next page without dropping the first, and preserves a completed detail until explicitly closed',async()=>{
 const f=environment(),requests:string[]=[];let failed=false,completed=false,refreshes=0;
 globalThis.fetch=async(url,init)=>{const path=String(url);requests.push(path);
  if(path.includes('/work-tasks?')){
   if(path.includes('offset=50')){if(!failed){failed=true;return Response.json({error:{message:'分页读取失败'}},{status:503});}return Response.json({tasks:[{...task,id:'other',title:'其他成员的任务',owner_id:'another',owner_name:'其他成员'}],next_offset:null});}
   return Response.json({tasks:completed?[]:[task],next_offset:completed?null:50});
  }
  if(path.includes('/observations?'))return Response.json({observations:[],next_cursor:null});
  if(path.endsWith('/work-tasks/complete')){completed=true;return Response.json({});}
  return Response.json({task:{...task,status:completed?'completed':'open',version:completed?4:3,result_text:'完成'},events:[],comments:[]});
 };
 try{
  const {ArchiveTasks}=await import('../app/client/ArchiveTasks');await act(async()=>f.root.render(<ArchiveTasks archiveId={id} archiveVersion={1} actor={actor} onChanged={()=>refreshes++} onOpenArchive={()=>{}}/>));
  const click=async(text:string)=>act(async()=>[...f.w.document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)!.click());
  await click('加载更多任务');assert.ok(f.w.document.body.textContent!.includes('分页读取失败'));assert.equal(f.w.document.querySelectorAll('.task-list-row').length,1);
  await click('重试');assert.equal(f.w.document.querySelectorAll('.task-list-row').length,2);assert.equal(requests.filter(p=>p.includes('offset=50')).length,2);
  await act(async()=>f.w.document.querySelector<HTMLButtonElement>('.task-index-item')!.click());
  await click('提交交付');const result=f.w.document.querySelector<HTMLTextAreaElement>('dialog[aria-label="提交交付"] textarea')!;
  // Use the native setter so React sees the input update.
  await act(async()=>{Object.getOwnPropertyDescriptor(f.w.HTMLTextAreaElement.prototype,'value')!.set!.call(result,'已完成核对');result.dispatchEvent(new f.w.Event('input',{bubbles:true}));});
  await act(async()=>{f.w.document.querySelector('dialog[aria-label="提交交付"] form')!.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));});
  assert.equal(refreshes,1);assert.ok(f.w.document.querySelector('dialog[aria-label="任务详情"]'));assert.ok(f.w.document.querySelector('.task-scene.stage-closed'));assert.equal(f.w.document.querySelectorAll('.task-list-row').length,0);
 }finally{await f.close();}
});

test('archive shortcut preserves target bindings, version and idempotency on retry; members and organizations have no action',async()=>{
 const f=environment(),sent:Record<string,unknown>[]=[];
 globalThis.fetch=async(url,init)=>{assert.equal(String(url),'/api/archives/state');sent.push(JSON.parse(String(init?.body)));return sent.length===1?Response.json({error:{message:'连接中断'}},{status:503}):Response.json({id,changed:true});};
 try{
  const {ArchiveQuickAction}=await import('../app/client/ArchiveQuickAction');let changed=0;
  const data={...archive,closed:false,deleted:false,bindings:{'人事审核':[{id:'bound-to-audit',name:'审核关联人'}]}} as unknown as import('../app/server/archives').Archive;
  await act(async()=>f.root.render(<ArchiveQuickAction archive={data} openTaskCount={2} onChanged={()=>changed++}/>));
  await act(async()=>f.w.document.querySelector<HTMLButtonElement>('.archive-primary-action button')!.click());assert.ok(f.w.document.body.textContent!.includes('现有 2 项开启任务会保留'));
  const submit=()=>f.w.document.querySelector<HTMLButtonElement>('dialog .modal-actions .primary')!.click();await act(async()=>submit());await act(async()=>submit());
  assert.equal(changed,1);assert.deepEqual(sent[0],sent[1]);assert.equal(sent[0].expected_version,2);assert.equal(sent[0].status,'人事审核');assert.deepEqual(sent[0].member_ids,['bound-to-audit']);
  for(const state of [{type:'org',status:'个人接触'},{type:'person',status:'已入伙'},{type:'person',status:'个人接触',closed:true},{type:'person',status:'个人接触',deleted:true}]){
   await act(async()=>f.root.render(<ArchiveQuickAction archive={{...data,...state} as typeof data} openTaskCount={0} onChanged={()=>{}}/>));assert.equal(f.w.document.querySelector('.archive-primary-action'),null);
  }
 }finally{await f.close();}
});
