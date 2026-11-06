import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {buildPersonnelMap,type MapArchive} from '../app/shared/personnel-map';
import {rankPersonnelMap} from '../app/shared/personnel-ranks';

test('rank flow shows five levels, preserves closed work/history controls and gives organizations their own detail actions',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/statistics/flow?view=people',pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','Event'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
 Object.defineProperty(w,'matchMedia',{value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client'),{PersonnelMap}=await import('../app/ui/PersonnelMap'),root=createRoot(w.document.getElementById('root')!);
 const a:MapArchive={id:'person',name:'候审人员',type:'person',status:'个人接触',person_role:'external',closed:false,version:1,resources:[],current_need:'',stage_since:new Date().toISOString(),open_tasks:0,unassigned_tasks:0,overdue_tasks:0,overdue:false,members:[],materials:0,observations:0},data=rankPersonnelMap({...buildPersonnelMap([a],[],{days:30,complete:true,history_complete:true,total_archives:1}),organizations:[{id:'org',name:'社外组织甲',status:'视奸观察',version:1,current_need:'了解情况',members:[],materials:0,observations:1}]});
 const pending=data.layers.find(l=>l.id==='pending')!,source=pending.cells[0],target={...source,id:'pending|other',key:'other',title:'同级承接容器'};pending.cells.push(target);
 data.links.push({id:'local-transfer',from:source.id,to:target.id,kind:'resource_transfer',people:[a.id],sources:[a.id]},{id:'local-shared',from:target.id,to:source.id,kind:'shared',people:[a.id],sources:[a.id]});
 const opened:string[]=[],edited:string[]=[];
 try{await act(async()=>root.render(<PersonnelMap data={data} query="" onQuery={()=>{}} onDays={()=>{}} onRefresh={()=>{}} onOpen={id=>opened.push(id)} onEdit={id=>edited.push(id)}/>));
 assert.deepEqual([...w.document.querySelectorAll('.pf-column h2')].map(n=>n.textContent),['待审核','审核中','审核通过','社员','社外社友']);assert.equal(w.document.querySelector('.pf-work-details')?.hasAttribute('open'),false);assert.equal(w.document.querySelector('.pm-history')?.hasAttribute('open'),false);
 assert.equal(w.document.querySelectorAll('.pf-ribbon').length,0,'same-rank moves and reciprocal references never appear in the rank diagram');
 const localButton=[...w.document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')==='查看容器：同级承接容器')!;await act(async()=>localButton.click());const local=w.document.querySelector('section[aria-label="同级调动与关联"]')!;assert.match(local.textContent!,/同级资源调动/);assert.match(local.textContent!,/共同关联/);await act(async()=>local.querySelector<HTMLButtonElement>('button')!.click());assert.match(w.document.querySelector('.pm-detail h2')!.textContent!,/同级资源调动/);assert.equal(w.document.querySelectorAll('.pf-ribbon').length,0);
 const orgButton=[...w.document.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.getAttribute('aria-label')==='查看容器：社外组织')!;await act(async()=>orgButton.click());assert.match(w.document.querySelector('.pf-org-detail')!.textContent!,/社外组织甲.*视奸观察/);assert.equal(w.document.querySelector('.pm-detail-counts'),null,'organization drawer has no personnel/plan quota counters');assert.equal(w.document.querySelector('.pf-org-detail')!.textContent!.includes('调动'),false);
 const open=[...w.document.querySelectorAll<HTMLButtonElement>('.pf-org-detail button')].find(b=>b.textContent==='查看组织档案')!;await act(async()=>open.click());assert.deepEqual(opened,['org']);assert.deepEqual(edited,[]);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
