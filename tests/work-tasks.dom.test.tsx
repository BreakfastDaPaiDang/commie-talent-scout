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
test('completed task in hall offers reopening to its owner',async()=>{
 const f=environment();f.w.history.replaceState(null,'','http://localhost/tasks');
 const completed={...task,status:'completed',completed_at:new Date().toISOString(),closed_at:new Date().toISOString(),result_text:'原交付结果'};
 globalThis.fetch=async url=>Response.json(String(url).includes('/work-tasks?')?{tasks:[completed],next_offset:null}:{events:[],comments:[]});
 try{
  const {WorkTasksPage}=await import('../app/client/WorkTasksPage');await act(async()=>f.root.render(<WorkTasksPage actor={{...actor,role:'member'}} onOpenArchive={()=>{}}/>));
  await act(async()=>[...f.w.document.querySelectorAll('button')].find(b=>b.textContent==='看板大厅')!.click());
  await act(async()=>f.w.document.querySelector<HTMLButtonElement>('.task-board-card-main')!.click());
  const reopen=[...f.w.document.querySelectorAll('dialog button')].find(b=>b.textContent==='重新开启') as HTMLButtonElement;
  assert.ok(reopen,'completed owner must have a reopen button in hall detail');await act(async()=>reopen.click());
  assert.ok(f.w.document.querySelector('.task-delay-options'));
 }finally{await f.close();}
});
test('task page exposes comment history, admin editing and versioned observation links',async()=>{
 const f=environment();
 const detail={events:[{kind:'task.edited',actor_name:'管理员',before_json:JSON.stringify({title:'旧标题',deadline_at:'2099-01-01T00:00:00Z'}),after_json:JSON.stringify({title:'新标题',deadline_at:'2099-02-01T00:00:00Z'}),created_at:'2026-10-08T12:01:00Z'}],comments:[{id:'comment',task_id:id,author_id:'other',author_name:'其他成员',body:'当前评论',references:[{observation_id:'observation',archive_id:archive.id,content_version:1}],history:[{version:1,body:'旧评论',deleted:false,references:[],created_at:'2026-10-08T12:00:00Z'},{version:2,body:'当前评论',deleted:false,references:[{observation_id:'observation',archive_id:archive.id,content_version:1}],created_at:'2026-10-08T12:01:00Z'}],created_at:'2026-10-08T12:00:00Z',updated_at:'2026-10-08T12:01:00Z',deleted:false,version:2}]};
 globalThis.fetch=async url=>{const path=String(url);if(path.includes('/work-tasks?'))return Response.json({tasks:[task]});if(path.endsWith('/work-tasks/'+id))return Response.json(detail);return Response.json({});};
 try{const {WorkTasksPage}=await import('../app/client/WorkTasksPage');await act(async()=>{f.root.render(<WorkTasksPage actor={actor} onOpenArchive={()=>{}}/>);await new Promise(resolve=>setTimeout(resolve,30));});assert.ok((f.w.document.body.textContent??'').includes('修改任务'));assert.ok((f.w.document.body.textContent??'').includes('标题：旧标题 → 新标题'));assert.ok((f.w.document.body.textContent??'').includes('编辑历史（2）'));assert.ok([...f.w.document.querySelectorAll('.work-task-comment footer button')].some(button=>button.textContent==='编辑'));assert.ok((f.w.document.body.textContent??'').includes('观察版本 1'));assert.ok(f.w.document.querySelector('[aria-label="任务评论"]'));assert.ok(f.w.document.querySelector('.task-owner-value img[alt="管理员的头像"]'));assert.ok(f.w.document.querySelector('.task-row-meta img[alt="管理员的头像"]'));const editButton=f.w.document.querySelector<HTMLButtonElement>('.task-edit-button');assert.ok(editButton);await act(async()=>{editButton?.click();});assert.ok((f.w.document.body.textContent??'').includes('截止时间'));assert.ok((f.w.document.body.textContent??'').includes('提交交付'));assert.ok((f.w.document.body.textContent??'').includes('延期'));assert.ok((f.w.document.body.textContent??'').includes('放弃'));
 }finally{await f.close();}
});

test('task book keeps the personal action list separate from other members work',async()=>{
 const f=environment();
 f.w.history.replaceState(null,'','http://localhost/tasks');
 const mine={...task,title:'我的进行中'};
 const waiting={...task,id:'c880c0af-ddb4-4005-9e7e-8e9b0e48dac2',title:'待领取工作',owner_id:null,owner_name:null,version:1};
 const other={...task,id:'d880c0af-ddb4-4005-9e7e-8e9b0e48dac3',title:'其他人的工作',owner_id:'other-member',owner_name:'其他成员',version:1};
 globalThis.fetch=async url=>{const path=String(url);if(path.includes('/work-tasks?'))return Response.json({tasks:[mine,waiting,other]});return Response.json({events:[],comments:[]});};
 try{const {WorkTasksPage}=await import('../app/client/WorkTasksPage');await act(async()=>{f.root.render(<WorkTasksPage actor={actor} onOpenArchive={()=>{}}/>);});
  const text=f.w.document.body.textContent??'';
  assert.ok(text.includes('任务簿'));assert.ok(text.includes('看板大厅'));assert.ok(text.includes('我的进行中'));assert.ok(text.includes('待领取工作'));assert.ok(f.w.document.querySelector('.task-mark-waiting'));assert.equal(text.includes('其他人的工作'),false);assert.equal(f.w.document.querySelector('.task-scene'),null);
 }finally{await f.close();}
});


test('hall defaults to 30 days of closures, can show 90 or all, and resets without hiding old open work',async()=>{
 const f=environment();f.w.history.replaceState(null,'','http://localhost/tasks');
 const ago=(days:number)=>new Date(Date.now()-days*86400000).toISOString();
 const rows=[
 {...task,id:'open',title:'长期开放',created_at:ago(180),updated_at:ago(180)},
 ...[10,60,120].map(days=>({...task,id:'closed-'+days,title:'关闭'+days,status:'cancelled',closed_at:ago(days),updated_at:ago(0)}))
 ];
 globalThis.fetch=async url=>Response.json(String(url).includes('/work-tasks?')?{tasks:rows,next_offset:null}:{events:[],comments:[]});
 try{
  const {WorkTasksPage}=await import('../app/client/WorkTasksPage');
  await act(async()=>{f.root.render(<WorkTasksPage actor={actor} onOpenArchive={()=>{}}/>);});
  await act(async()=>{[...f.w.document.querySelectorAll('button')].find(b=>b.textContent==='看板大厅')!.click();});
  const titles=()=>[...f.w.document.querySelectorAll('.task-board-card h3')].map(x=>x.textContent);
  assert.deepEqual(titles(),['长期开放','关闭10']);
  assert.ok(f.w.document.body.textContent!.includes('最近 30 天内关闭的任务'));
  await act(async()=>{f.w.document.querySelector<HTMLButtonElement>('.filter-toggle')!.click();});
  const select=f.w.document.querySelector('[aria-label="已关闭任务范围"]') as unknown as HTMLSelectElement;
  assert.equal(select.value,'30');
  await act(async()=>{select.value='90';select.dispatchEvent(new f.w.Event('change',{bubbles:true}));});
  assert.deepEqual(titles(),['长期开放','关闭10','关闭60']);
  await act(async()=>{select.value='all';select.dispatchEvent(new f.w.Event('change',{bubbles:true}));});
  assert.equal(titles().length,4);
  await act(async()=>{[...f.w.document.querySelectorAll('button')].find(b=>b.textContent==='重置筛选')!.click();});
  assert.equal(select.value,'30');assert.deepEqual(titles(),['长期开放','关闭10']);
 }finally{await f.close();}
});


test('initiator avatar is present in the task book, hall card and hall detail',async()=>{
 const f=environment(),initiator={...task,initiator_kind:'member',initiator_id:'30000000-0000-4000-8000-000000000001',initiator_name:'虚构发起人',initiator_version:7};
 globalThis.fetch=async url=>String(url).includes('/work-tasks?')?Response.json({tasks:[initiator]}):Response.json({events:[],comments:[]});
 const assertAvatar=(selector:string)=>{const img=f.w.document.querySelector(selector+' img[alt="虚构发起人的头像"]');assert.ok(img);assert.equal(img.getAttribute('src'),'/avatars/members/'+initiator.initiator_id+'?v=7');};
 try{
  const {WorkTasksPage}=await import('../app/client/WorkTasksPage');await act(async()=>f.root.render(<WorkTasksPage actor={actor} onOpenArchive={()=>{}}/>));assertAvatar('.task-scene-meta-grid');
  await act(async()=>[...f.w.document.querySelectorAll('button')].find(b=>b.textContent==='看板大厅')!.click());assertAvatar('.task-board-card');await act(async()=>f.w.document.querySelector<HTMLButtonElement>('.task-board-card-main')!.click());assertAvatar('dialog');
 }finally{await f.close();}
});


test('task defaults put higher priorities first, retain manual hall sorting and reset',async()=>{
 const f=environment();f.w.history.replaceState(null,'','http://localhost/tasks');
 const rows=[{...task,id:'normal',title:'常规新任务',priority:'P2',updated_at:'2026-10-12T00:00:00Z'},{...task,id:'important-old',title:'重要旧任务',priority:'P1',updated_at:'2026-10-01T00:00:00Z'},{...task,id:'urgent',title:'紧急任务',priority:'P0',updated_at:'2026-09-01T00:00:00Z'},{...task,id:'important-new',title:'重要新任务',priority:'P1',updated_at:'2026-10-11T00:00:00Z'}];
 globalThis.fetch=async()=>Response.json({tasks:rows,next_offset:null});
 try{
  const {WorkTasksPage}=await import('../app/client/WorkTasksPage');await act(async()=>f.root.render(<WorkTasksPage actor={actor} onOpenArchive={()=>{}}/>));
  const expected=['紧急任务','重要新任务','重要旧任务','常规新任务'];
  assert.deepEqual([...f.w.document.querySelectorAll('.task-row-title strong')].map(e=>e.textContent),expected);
  await act(async()=>[...f.w.document.querySelectorAll('button')].find(b=>b.textContent==='看板大厅')!.click());
  const titles=()=>[...f.w.document.querySelectorAll('.task-board-card h3')].map(e=>e.textContent);assert.deepEqual(titles(),expected);
  await act(async()=>f.w.document.querySelector<HTMLButtonElement>('.filter-toggle')!.click());
  const sort=f.w.document.querySelector('[aria-label="任务排序"]') as unknown as HTMLSelectElement;assert.equal(sort.value,'priority');
  await act(async()=>{sort.value='updated';sort.dispatchEvent(new f.w.Event('change',{bubbles:true}));});assert.equal(titles()[0],'常规新任务');
  await act(async()=>[...f.w.document.querySelectorAll('button')].find(b=>b.textContent==='重置筛选')!.click());assert.equal(sort.value,'priority');assert.deepEqual(titles(),expected);
 }finally{await f.close();}
});

test('task history loads older comments and events and removes exhausted continuation',async()=>{
 const f=environment(),requests:string[]=[];
 globalThis.fetch=async url=>{const path=String(url);requests.push(path);if(path.includes('/work-tasks?'))return Response.json({tasks:[task]});if(path.includes('/history?'))return Response.json({items:path.includes('section=comments')?[{id:'old-comment',author_id:actor.id,author_name:actor.name,body:'较早的评论',references:[],history:[],created_at:'2026-01-01T00:00:00Z',version:1,deleted:false}]:[{kind:'task.created',actor_name:'历史创建人',created_at:'2026-01-01T00:00:00Z'}],next_cursor:null});return Response.json({comments:[],events:[],comments_next_cursor:'comments-cursor',events_next_cursor:'events-cursor'});};
 try{const {WorkTasksPage}=await import('../app/client/WorkTasksPage');await act(async()=>f.root.render(<WorkTasksPage actor={actor} onOpenArchive={()=>{}}/>));
  await act(async()=>[...f.w.document.querySelectorAll('button')].find(b=>b.textContent==='加载更早记录')!.click());
  assert.ok(f.w.document.body.textContent!.includes('较早的评论'));assert.ok(f.w.document.body.textContent!.includes('历史创建人'));assert.ok(requests.some(path=>path.includes('cursor=comments-cursor')));assert.ok(requests.some(path=>path.includes('cursor=events-cursor')));assert.equal([...f.w.document.querySelectorAll('button')].some(b=>b.textContent==='加载更早记录'),false);
 }finally{await f.close();}
});

test('task book filters every actual label independently of legacy kind and preserves status filters',async()=>{
 const f=environment();f.w.history.replaceState(null,'','http://localhost/tasks');
 const rows=[
  {...task,id:'monthly-active',title:'月度进行中',kind:'custom',label_keys:['monthly','接触跟进'],labels:['月度沟通','接触跟进']},
  {...task,id:'monthly-waiting',title:'月度待接取',kind:'custom',owner_id:null,label_keys:['monthly'],labels:['月度沟通']},
  {...task,id:'audit-active',title:'审核进行中',kind:'audit',label_keys:['audit'],labels:['人事审核']},
  {...task,id:'completed',title:'本人已完成',status:'completed',priority:'P1',completed_at:new Date(Date.now()-1000).toISOString()},
  {...task,id:'other-completed',title:'他人已完成',status:'completed',owner_id:'other',completed_at:new Date(Date.now()-1000).toISOString()},
 ];
 globalThis.fetch=async url=>Response.json(String(url).includes('work-task-labels')?{labels:[{key:'monthly',name:'月度沟通'},{key:'接触跟进',name:'接触跟进'},{key:'audit',name:'人事审核'}],next_offset:null}:{tasks:rows,next_offset:null});
 try{
  const {WorkTasksPage}=await import('../app/client/WorkTasksPage');await act(async()=>f.root.render(<WorkTasksPage actor={actor} onOpenArchive={()=>{}}/>));
  await act(async()=>f.w.document.querySelector<HTMLButtonElement>('.task-book-controls button')!.click());
  assert.equal(f.w.document.querySelector('.task-progress-total strong')?.textContent,'1');
  assert.ok(f.w.document.querySelector('.task-recommendation-copy')?.textContent?.includes('月度沟通'));
  assert.equal(f.w.document.querySelector('.task-recommendation-copy')?.textContent?.includes('临时工作'),false);
  await act(async()=>f.w.document.querySelector<HTMLButtonElement>('.task-label-toggle')!.click());await act(async()=>{await new Promise(resolve=>setTimeout(resolve,220));});
  const toggle=async(name:string)=>act(async()=>[...f.w.document.querySelectorAll<HTMLLabelElement>('.task-label-results label')].find(e=>e.textContent===name)!.querySelector<HTMLInputElement>('input')!.click());
  const titles=()=>[...f.w.document.querySelectorAll('.task-row-title strong')].map(e=>e.textContent);
  const choose=async(selector:HTMLSelectElement,value:string)=>act(async()=>{selector.value=value;selector.dispatchEvent(new f.w.Event('change',{bubbles:true}));});
  await toggle('月度沟通');assert.deepEqual(new Set(titles()),new Set(['月度进行中','月度待接取']));
  await choose(f.w.document.querySelector('[aria-label="任务状态"]') as unknown as HTMLSelectElement,'active');assert.deepEqual(titles(),['月度进行中']);
  await toggle('接触跟进');await toggle('月度沟通');assert.deepEqual(titles(),['月度进行中']);assert.equal(f.w.document.querySelector('.task-progress-total strong')?.textContent,'1');
  await act(async()=>[...f.w.document.querySelectorAll<HTMLButtonElement>('.task-book-filters button')].find(e=>e.textContent==='清除')!.click());assert.equal(titles().length,3);
 }finally{await f.close();}
});

test('task book groups processing states before priority and never groups by legacy kind',async()=>{
 const f=environment();f.w.history.replaceState(null,'','http://localhost/tasks');
 const rows=[
  {...task,id:'waiting-urgent',title:'等待 P0',owner_id:null,priority:'P0',kind:'audit'},
  {...task,id:'active-normal',title:'进行 P2',priority:'P2',kind:'monthly'},
  {...task,id:'ready-normal',title:'提交 P2',priority:'P2',ready_to_submit:true},
  {...task,id:'failed-normal',title:'关闭 P2',status:'expired',priority:'P2'},
  {...task,id:'active-urgent',title:'进行 P0',priority:'P0',kind:'cooperation'},
  {...task,id:'cancelled-normal',title:'取消 P2',status:'cancelled',priority:'P2'},
 ];
 globalThis.fetch=async()=>Response.json({tasks:rows,next_offset:null});
 try{
  const {WorkTasksPage}=await import('../app/client/WorkTasksPage');await act(async()=>f.root.render(<WorkTasksPage actor={actor} onOpenArchive={()=>{}}/>));
  assert.deepEqual([...f.w.document.querySelectorAll('.task-row-title strong')].map(e=>e.textContent),['关闭 P2','取消 P2','提交 P2','进行 P0','进行 P2','等待 P0']);
 }finally{await f.close();}
});
