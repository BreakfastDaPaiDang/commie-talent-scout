import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

const id='b880c0af-ddb4-4005-9e7e-8e9b0e48dac1',ticket='9584fe0a-7eaf-45c7-b198-61bf7b40ac5f';
const actor={id:'00863713-2463-471a-925f-ad9c2f5eeb91',username:'fixture',name:'虚构测试成员',role:'member' as const,must_change_password:false,version:1,qq:null,avatar_id:null};
const archive={id,type:'person',name:'虚构整档阅读',status:'视奸观察',closed:false,deleted:false,version:1,contacts:[],links:[],members:[],bindings:{},tags:[],avatar_id:null,observation_count:45,latest_observation:'正文',updated_at:'2026-09-08T12:00:00Z'};
const delivery={ticket,archive_id:id,through_seq:50};
function environment(){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/?archive='+id,pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','HTMLImageElement','Event','CustomEvent','location','history','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(f:()=>void)=>setTimeout(f,0),IntersectionObserver:class{observe(){}disconnect(){}}});
 w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLElement.prototype.getClientRects=function(){return {length:1} as DOMRectList;};
 const root=createRoot(w.document.getElementById('root')!);
 return {w,root,async close(){await act(async()=>root.unmount());dom.window.close();}};
}
const settle=()=>act(async()=>{await new Promise(r=>setTimeout(r,30));});
function otherResponse(url:string){return Response.json(url.includes('/timeline')?{events:[],next_cursor:null}:url.includes('/members')?{members:[],next_cursor:null}:url.includes('/drafts')?{drafts:[],draft:null}:url.includes('/archives?')?{archives:[archive],counts:{all:1,mine:0,unread:1},next_cursor:null}:url.includes('/material-capacity')?{count:0}:{tags:[],next_cursor:null});}

test('a successful foreground detail acknowledges the archive once; background refresh does not consume a newer opening snapshot',async()=>{
 const f=environment(),sent:string[]=[],confirmed:unknown[]=[];let detailReads=0;
 const {ArchivesPage}=await import('../app/client/ArchivesPage');
 globalThis.fetch=async(url,options)=>{
  const path=String(url);
  if(path==='/api/archives/'+id){detailReads++;return Response.json({archive,archive_reading:{...delivery,ticket:detailReads===1?ticket:'8b4c3ef3-9522-4f7d-aa66-7b97ebd80477',through_seq:detailReads===1?50:51}});}
  if(path==='/api/reading/archive'){sent.push(JSON.parse(String(options?.body)).ticket);return Response.json({member_id:actor.id,archive_id:id,through_seq:50,confirmed:true,unread_event_ids:[]});}
  if(path==='/api/reading/confirm')assert.fail('web detail must not confirm individual content events');
  return otherResponse(path);
 };
 f.w.addEventListener('cts-archive-reading-confirmed',e=>confirmed.push((e as CustomEvent).detail));
 try{
  await act(async()=>f.root.render(<ArchivesPage actor={actor} type="person"/>));await settle();
  assert.deepEqual(sent,[ticket]);assert.deepEqual(confirmed,[{member_id:actor.id,archive_id:id,through_seq:50,confirmed:true,unread_event_ids:[]}]);
  await act(async()=>{f.w.dispatchEvent(new f.w.CustomEvent('cts-reading-confirmed',{detail:[]}));await new Promise(r=>setTimeout(r,850));});await settle();
  assert.ok(detailReads>=2);assert.deepEqual(sent,[ticket],'the original open is retained across count and detail refreshes');
 }finally{await f.close();}
});

test('the unread queue marks an opened archive together and next navigates to a different still-unread archive',async()=>{
 const f=environment(),{UnreadPage}=await import('../app/client/UnreadPage'),otherId='459e49d6-f943-41b9-8a3c-f21ed41c5d6a';
 f.w.history.replaceState(null,'','/unread');
 const entry=(key:string,seq:number,archiveId=id)=>({id:key,seq,archive_id:archiveId,archive_name:archiveId===id?archive.name:'虚构下一张组织',type:archiveId===id?'person':'org',closed:0,kind:'archive.created',actor_id:'writer',actor_name:'虚构作者',created_at:'2026-09-08T12:00:00Z',observation:null,before:null,after:{}});
 const entries=[entry('event-a',50),entry('event-b',49),entry('event-c',48,otherId)],nextRequests:string[]=[];
 globalThis.fetch=async(url,options)=>{
  const path=String(url),u=new URL(path,'http://localhost');
  if(u.pathname==='/api/reading/events'){
   if(u.searchParams.has('exclude_archive_id')){nextRequests.push(u.searchParams.get('exclude_archive_id')!);return Response.json({events:[entries[2]],snapshot:50,next_cursor:null});}
   return Response.json({events:entries,snapshot:50,next_cursor:null});
  }
  if(path==='/api/archives/'+id)return Response.json({archive,archive_reading:delivery});
  if(path==='/api/archives/'+otherId)return Response.json({archive:{...archive,id:otherId,name:'虚构下一张组织',type:'org'},archive_reading:null});
  if(path==='/api/reading/archive')return Response.json({member_id:actor.id,archive_id:id,through_seq:50,confirmed:true,unread_event_ids:[]});
  if(u.pathname.startsWith('/api/events/'))return Response.json({event:entries.find(e=>e.id===u.pathname.split('/').pop())});
  return otherResponse(path);
 };
 try{
  await act(async()=>f.root.render(<UnreadPage actor={actor}/>));await settle();
  assert.equal(f.w.document.querySelectorAll('.update-row.read').length,1,'both events of the opened archive become one read group');
  assert.match(f.w.document.querySelector('.unread-progress')!.textContent!,/2 \/ 3/);
  const next=Array.from(f.w.document.querySelectorAll('button')).find(e=>e.textContent==='下一处未读 →')!;
  await act(async()=>next.click());await settle();
  assert.deepEqual(nextRequests,[id]);assert.equal(f.w.document.querySelector('.entity-heading h1')!.textContent,'虚构下一张组织');
 }finally{await f.close();}
});

test('archive acknowledgement waits for a visible uncovered detail and retries transient failure using exactly the same ticket',async()=>{
 const f=environment(),{ArchiveRead,ArchiveReadingScope,ReadBoundary}=await import('../app/client/Reading'),container=React.createRef<HTMLDivElement>(),sent:string[]=[];
 let shown=false,observerCount=0;
 Object.assign(globalThis,{IntersectionObserver:class{constructor(){observerCount++;}observe(){}disconnect(){}}});
 f.w.HTMLElement.prototype.getClientRects=function(){return {length:shown?1:0} as DOMRectList;};
 Object.defineProperty(f.w.document,'visibilityState',{value:'hidden',configurable:true});
 globalThis.fetch=async(url,options)=>{assert.equal(String(url),'/api/reading/archive');sent.push(JSON.parse(String(options?.body)).ticket);return sent.length===1?Response.json({error:{code:'UNAVAILABLE',message:'一次虚构中断'}},{status:503}):Response.json({member_id:actor.id,archive_id:id,through_seq:50,confirmed:true,unread_event_ids:[]});};
 try{
  await act(async()=>f.root.render(<div ref={container}><ArchiveReadingScope.Provider value={true}><ArchiveRead delivery={delivery} container={container}/><ReadBoundary reading={{event_id:'body',ticket:'individual'}}/></ArchiveReadingScope.Provider></div>));
  await act(async()=>{await new Promise(r=>setTimeout(r,300));});assert.equal(sent.length,0);assert.equal(observerCount,0,'the web opening suppresses legacy per-event auto-reading');
  Object.defineProperty(f.w.document,'visibilityState',{value:'visible',configurable:true});await act(async()=>f.w.document.dispatchEvent(new f.w.Event('visibilitychange')));assert.equal(sent.length,0,'hidden mobile detail does not count as opening');
  shown=true;const dialog=f.w.document.createElement('dialog');dialog.open=true;f.w.document.body.appendChild(dialog);
  await act(async()=>{await new Promise(r=>setTimeout(r,300));});assert.equal(sent.length,0);
  dialog.remove();await act(async()=>{await new Promise(r=>setTimeout(r,300));});assert.deepEqual(sent,[ticket]);assert.match(f.w.document.body.textContent!,/正在重试/);
  await act(async()=>{await new Promise(r=>setTimeout(r,5400));});assert.deepEqual(sent,[ticket,ticket]);assert.doesNotMatch(f.w.document.body.textContent!,/正在重试/);
 }finally{await f.close();}
});

test('failed or superseded detail responses never acknowledge an archive',async()=>{
 const f=environment(),{ArchivesPage}=await import('../app/client/ArchivesPage');let release!:(r:Response)=>void;const delayed=new Promise<Response>(resolve=>{release=resolve;}),sent:string[]=[];
 globalThis.fetch=async(url)=>{const path=String(url);if(path==='/api/archives/'+id)return delayed;if(path==='/api/reading/archive'){sent.push(path);return Response.json({});}return otherResponse(path);};
 try{
  await act(async()=>f.root.render(<ArchivesPage actor={actor} type="person"/>));assert.equal(sent.length,0);
  const close=f.w.document.querySelector<HTMLButtonElement>('button[aria-label="关闭档案详情"]')!;
  await act(async()=>close.click());await act(async()=>release(Response.json({archive,archive_reading:delivery})));await settle();assert.equal(sent.length,0);
  await act(async()=>f.root.unmount());
 }finally{release(Response.json({archive,archive_reading:delivery}));await f.close();}
});

test('refreshing the unread queue reopens a still-selected archive for its new events',async()=>{
 const f=environment(),{UnreadPage}=await import('../app/client/UnreadPage');f.w.history.replaceState(null,'','/unread');let round=0,confirmations=0;
 globalThis.fetch=async(url)=>{
  const path=String(url),entry={id:'event-'+round,seq:50+round,archive_id:id,archive_name:archive.name,type:'person',closed:0,kind:'archive.created',actor_id:'writer',actor_name:'虚构作者',created_at:'2026-09-08T12:00:00Z',observation:null,before:null,after:{}};
  if(path.startsWith('/api/reading/events'))return Response.json({events:[entry],snapshot:entry.seq,next_cursor:null});
  if(path==='/api/archives/'+id)return Response.json({archive,archive_reading:{...delivery,ticket:round===0?ticket:'8b4c3ef3-9522-4f7d-aa66-7b97ebd80477',through_seq:entry.seq}});
  if(path==='/api/reading/archive'){confirmations++;return Response.json({member_id:actor.id,archive_id:id,through_seq:entry.seq,confirmed:true,unread_event_ids:[]});}
  if(path.startsWith('/api/events/'))return Response.json({event:entry});return otherResponse(path);
 };
 try{
  await act(async()=>f.root.render(<UnreadPage actor={actor}/>));await settle();assert.equal(confirmations,1);
  round++;const refresh=Array.from(f.w.document.querySelectorAll('button')).find(e=>e.textContent==='刷新队列')!;
  await act(async()=>refresh.click());await settle();assert.equal(confirmations,2);
 }finally{await f.close();}
});

test('queue confirmation belongs to the current member and preserves the server remaining-event exceptions',async()=>{
 const f=environment(),{UnreadPage}=await import('../app/client/UnreadPage');f.w.history.replaceState(null,'','/unread');
 const entries=['first','protected'].map((key,i)=>({id:key,seq:50-i,archive_id:id,archive_name:archive.name,type:'person',closed:0,kind:'archive.created',actor_id:'writer',actor_name:'虚构作者',created_at:'2026-09-08T12:00:00Z',observation:null,before:null,after:{}}));
 globalThis.fetch=async url=>{const path=String(url);if(path.startsWith('/api/reading/events'))return Response.json({events:entries,snapshot:50,next_cursor:null});if(path==='/api/archives/'+id)return Response.json({archive,archive_reading:null});if(path.startsWith('/api/events/'))return Response.json({event:entries[0]});return otherResponse(path);};
 try{
  await act(async()=>f.root.render(<UnreadPage actor={actor}/>));await settle();
  await act(async()=>f.w.dispatchEvent(new f.w.CustomEvent('cts-archive-reading-confirmed',{detail:{member_id:'a-previous-session',archive_id:id,through_seq:50,confirmed:true,unread_event_ids:[]}})));
  assert.match(f.w.document.querySelector('.unread-progress')!.textContent!,/0 \/ 2/);
  await act(async()=>f.w.dispatchEvent(new f.w.CustomEvent('cts-archive-reading-confirmed',{detail:{member_id:actor.id,archive_id:id,through_seq:50,confirmed:true,unread_event_ids:['protected']}})));
  assert.match(f.w.document.querySelector('.unread-progress')!.textContent!,/1 \/ 2/);
 }finally{await f.close();}
});

test('a late next-unread response cannot replace an archive explicitly selected while it was pending',async()=>{
 const f=environment(),{UnreadPage}=await import('../app/client/UnreadPage');f.w.history.replaceState(null,'','/unread');
 const ids=[id,'459e49d6-f943-41b9-8a3c-f21ed41c5d6a','8b4c3ef3-9522-4f7d-aa66-7b97ebd80477'],entries=ids.map((key,i)=>({id:'event-'+i,seq:50-i,archive_id:key,archive_name:'虚构队列 '+i,type:'person',closed:0,kind:'archive.created',actor_id:'writer',actor_name:'虚构作者',created_at:'2026-09-08T12:00:00Z',observation:null,before:null,after:{}}));
 let release!:(r:Response)=>void;const pending=new Promise<Response>(r=>{release=r;});
 globalThis.fetch=async url=>{
  const u=new URL(String(url),'http://localhost');if(u.pathname==='/api/reading/events')return u.searchParams.has('exclude_archive_id')?pending:Response.json({events:entries,snapshot:50,next_cursor:null});
  if(u.pathname.startsWith('/api/archives/')&&!u.pathname.endsWith('/timeline')){const entry=entries.find(e=>e.archive_id===u.pathname.split('/').pop())!;return Response.json({archive:{...archive,id:entry.archive_id,name:entry.archive_name},archive_reading:null});}
  if(u.pathname.startsWith('/api/events/'))return Response.json({event:entries.find(e=>e.id===u.pathname.split('/').pop())});return otherResponse(String(url));
 };
 try{
  await act(async()=>f.root.render(<UnreadPage actor={actor}/>));await settle();
  const next=Array.from(f.w.document.querySelectorAll('button')).find(e=>e.textContent==='下一处未读 →')!;await act(async()=>next.click());
  const third=Array.from(f.w.document.querySelectorAll<HTMLButtonElement>('.update-row')).find(e=>e.textContent!.includes('虚构队列 2'))!;await act(async()=>third.click());await settle();
  await act(async()=>release(Response.json({events:[entries[1]]})));await settle();assert.equal(f.w.document.querySelector('.entity-heading h1')!.textContent,'虚构队列 2');
 }finally{release(Response.json({events:[]}));await f.close();}
});

test('an older unread-count response cannot restore a badge after the latest archive confirmation cleared it',async()=>{
 const f=environment(),{UnreadBadge}=await import('../app/client/UnreadPage');let release!:(r:Response)=>void;const pending=new Promise<Response>(r=>{release=r;});let calls=0;
 globalThis.fetch=async()=>++calls===1?pending:Response.json({total:0});
 try{
  await act(async()=>f.root.render(<UnreadBadge/>));await act(async()=>{await new Promise(r=>setTimeout(r,550));});assert.equal(calls,1);
  await act(async()=>{f.w.dispatchEvent(new f.w.CustomEvent('cts-reading-confirmed',{detail:[]}));await new Promise(r=>setTimeout(r,550));});assert.equal(calls,2);
  await act(async()=>release(Response.json({total:4})));assert.equal(f.w.document.querySelectorAll('.nav-unread').length,0);
 }finally{release(Response.json({total:4}));await f.close();}
});

test('opening the only unread archive completes a paginated queue without an extra next click',async()=>{
 const f=environment(),{UnreadPage}=await import('../app/client/UnreadPage');f.w.history.replaceState(null,'','/unread');let checks=0;
 const entries=Array.from({length:30},(_,i)=>({id:'event-'+i,seq:50-i,archive_id:id,archive_name:archive.name,type:'person',closed:0,kind:'archive.created',actor_id:'writer',actor_name:'虚构作者',created_at:'2026-09-08T12:00:00Z',observation:null,before:null,after:{}}));
 globalThis.fetch=async url=>{
  const u=new URL(String(url),'http://localhost');
  if(u.pathname==='/api/reading/events'){if(u.searchParams.get('limit')==='1'){checks++;return Response.json({events:[],snapshot:50,next_cursor:null});}return Response.json({events:entries,snapshot:50,next_cursor:'21'});}
  if(u.pathname==='/api/archives/'+id)return Response.json({archive,archive_reading:delivery});
  if(u.pathname==='/api/reading/archive')return Response.json({member_id:actor.id,archive_id:id,through_seq:50,confirmed:true,unread_event_ids:[]});
  if(u.pathname.startsWith('/api/events/'))return Response.json({event:entries[0]});return otherResponse(String(url));
 };
 try{
  await act(async()=>f.root.render(<UnreadPage actor={actor}/>));await settle();
  assert.equal(checks,1);assert.match(f.w.document.body.textContent!,/近况，都看过了。/);
 }finally{await f.close();}
});
