import {ActivityStream} from '../app/client/ActivityStream';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {ReadBoundary} from '../app/client/Reading';
const id='b880c0af-ddb4-4005-9e7e-8e9b0e48dac1',actor={id:'00863713-2463-471a-925f-ad9c2f5eeb91',username:'fixture',name:'虚构测试成员',role:'member' as const,must_change_password:false,version:1,qq:null,avatar_id:null};
function environment(){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/?archive='+id,pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','HTMLImageElement','Event','CustomEvent','location','history','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(f:()=>void)=>setTimeout(f,0)});
 w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLElement.prototype.getClientRects=function(){return {length:1} as DOMRectList;};
 const observers:{element?:Element;callback:IntersectionObserverCallback}[]=[];
 class IO{entry:{element?:Element;callback:IntersectionObserverCallback};constructor(callback:IntersectionObserverCallback){this.entry={callback};observers.push(this.entry);}observe(element:Element){this.entry.element=element;}disconnect(){this.entry.element=undefined;}}
 Object.assign(globalThis,{IntersectionObserver:IO});const root=createRoot(w.document.getElementById('root')!);
 return {w,dom,root,observers,async close(){await act(async()=>root.unmount());dom.window.close();}};
}
const archive={id,type:'person',name:'虚构对齐档案',status:'视奸观察',closed:false,version:1,contacts:[],links:[],members:[],bindings:{},tags:[],avatar_id:null,observation_count:1,latest_observation:'正文',updated_at:'2026-09-08T12:00:00Z'};
test('approved workspace keeps name and state together, compact header, and tabs above composer',async()=>{
 const f=environment();const {ArchivesPage}=await import('../app/client/ArchivesPage');globalThis.fetch=async url=>Response.json(String(url).includes('/timeline')?{events:[],next_cursor:null}:String(url).includes('/members')?{members:[],next_cursor:null}:String(url).includes('/drafts')?{drafts:[]}:String(url).includes('/draft/')?{draft:null}:String(url).includes('/archives?')?{archives:[archive],next_cursor:null}:{archive});
 try{await act(async()=>{f.root.render(<ArchivesPage actor={actor} type="person"/>);});await act(async()=>{await new Promise(r=>setTimeout(r,300));});
  assert.ok(f.w.document.querySelector('.archive-head .archives-search'),'approved compact header contains search instead of a separate tall block');
  assert.ok(f.w.document.querySelector('.entity-heading h1 + .state-badge'),'name and state share the approved heading row');
  const tabs=f.w.document.querySelector('.observation-toolbar')!,composer=f.w.document.querySelector('.observation-composer')!;assert.ok(tabs.compareDocumentPosition(composer)&4,'timeline tabs precede the composer');
 }finally{await f.close();}
});
test('real reading component waits for visible content, pauses behind dialogs/background and retries failed confirmation',async()=>{
 const f=environment(),requests:string[]=[];let fail=true;
 globalThis.fetch=async(_url,options)=>{requests.push(String(options?.body));if(fail){fail=false;throw new Error('offline fixture');}return Response.json({confirmed:[{event_id:'event',ticket:'ticket'}],unconfirmed:[]});};
 try{await act(async()=>{f.root.render(<article><div className="reading-content"><ReadBoundary reading={{event_id:'event',ticket:'ticket'}}/>真实正文</div></article>);});const observer=f.observers[0];
  const visible=(ratio:number)=>observer.callback([{target:observer.element,intersectionRatio:ratio}] as IntersectionObserverEntry[],{} as IntersectionObserver);
  await act(async()=>{visible(0);await new Promise(r=>setTimeout(r,850));});assert.equal(requests.length,0);
  Object.defineProperty(f.w.document,'visibilityState',{value:'hidden',configurable:true});await act(async()=>{visible(1);await new Promise(r=>setTimeout(r,850));});assert.equal(requests.length,0);
  Object.defineProperty(f.w.document,'visibilityState',{value:'visible',configurable:true});const dialog=f.w.document.createElement('dialog');dialog.setAttribute('open','');f.w.document.body.appendChild(dialog);await act(async()=>{await new Promise(r=>setTimeout(r,850));});assert.equal(requests.length,0);dialog.remove();
  await act(async()=>{await new Promise(r=>setTimeout(r,850));});assert.equal(requests.length,1);assert.match(f.w.document.body.textContent??'',/正在重试/);
  await act(async()=>{await new Promise(r=>setTimeout(r,5300));});assert.equal(requests.length,2);
 }finally{await f.close();}
});

test('five-minute group shows observation body and mounts operation reading boundaries only after expansion',async()=>{
 const f=environment();const make=(name:string,kind:string,observation:unknown)=>({id:name,archive_id:id,actor_id:actor.id,actor_name:actor.name,created_at:'2026-09-08T12:00:00Z',kind,observation});
 const events=[make('tag','archive.tags_changed',null),make('body','observation.created',{}),make('created','archive.created',null)];
 const content=(e:typeof events[number])=><div data-event={e.id}><ReadBoundary reading={{event_id:e.id,ticket:e.id}}/>{e.id==='body'?'实际观察正文':'完整操作明细 '+e.id}</div>;
 try{await act(async()=>{f.root.render(<ActivityStream events={events} renderRecord={content} renderEvent={content}/>);});assert.equal(f.w.document.querySelectorAll('.activity-group').length,1);assert.equal(f.w.document.querySelectorAll('.reading-boundary').length,1);assert.match(f.w.document.body.textContent??'',/实际观察正文/);assert.ok(!f.w.document.body.textContent?.includes('完整操作明细'));
  const details=f.w.document.querySelector('details')!;await act(async()=>{details.open=true;details.dispatchEvent(new f.w.Event('toggle'));await new Promise(r=>setTimeout(r,20));});assert.equal(f.w.document.querySelectorAll('.reading-boundary').length,3);assert.match(f.w.document.body.textContent??'',/完整操作明细 tag/);
  await act(async()=>{details.open=false;details.dispatchEvent(new f.w.Event('toggle'));await new Promise(r=>setTimeout(r,20));});assert.equal(f.w.document.querySelectorAll('.reading-boundary').length,1);
 }finally{await f.close();}
});
