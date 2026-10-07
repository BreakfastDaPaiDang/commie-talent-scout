import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';

const id='b880c0af-ddb4-4005-9e7e-8e9b0e48dac1';
const actor={id:'00863713-2463-471a-925f-ad9c2f5eeb91',username:'fixture',name:'管理员',role:'admin' as const,must_change_password:false,version:1,qq:null,avatar_id:null};
const archive={id,type:'person' as const,name:'任务对象',status:'个人接触',version:2,updated_at:'2026-10-08T12:00:00Z',observation_count:2,latest_observation:'最近观察',members:[],tag_summary:{tags:[],total:0}};
const task={id,archive_id:archive.id,archive_preview:archive,kind:'custom' as const,title:'核对任务',purpose:'确认当前进展',delivery:'写回结果',status:'open' as const,owner_id:actor.id,owner_name:actor.name,created_by:actor.id,deadline_at:'2099-01-01T00:00:00Z',created_at:'2026-10-08T12:00:00Z',version:3};
function environment(){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/tasks?task='+id,pretendToBeVisual:true}),w=dom.window;
 for(const key of ['window','document','HTMLElement','Event','CustomEvent','location','history','localStorage','sessionStorage'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(f:()=>void)=>setTimeout(f,0)});
 const root=createRoot(w.document.getElementById('root')!);
 return {dom,w,root,async close(){await act(async()=>root.unmount());dom.window.close();}};
}
test('task page exposes comment history, admin editing and versioned observation links',async()=>{
 const f=environment();
 const detail={events:[{kind:'task.edited',actor_name:'管理员',before_json:JSON.stringify({title:'旧标题',deadline_at:'2099-01-01T00:00:00Z'}),after_json:JSON.stringify({title:'新标题',deadline_at:'2099-02-01T00:00:00Z'}),created_at:'2026-10-08T12:01:00Z'}],comments:[{id:'comment',task_id:id,author_id:'other',author_name:'其他成员',body:'当前评论',references:[{observation_id:'observation',archive_id:archive.id,content_version:1}],history:[{version:1,body:'旧评论',deleted:false,references:[],created_at:'2026-10-08T12:00:00Z'},{version:2,body:'当前评论',deleted:false,references:[{observation_id:'observation',archive_id:archive.id,content_version:1}],created_at:'2026-10-08T12:01:00Z'}],created_at:'2026-10-08T12:00:00Z',updated_at:'2026-10-08T12:01:00Z',deleted:false,version:2}]};
 globalThis.fetch=async url=>{const path=String(url);if(path.includes('/work-tasks?'))return Response.json({tasks:[task]});if(path.endsWith('/work-tasks/'+id))return Response.json(detail);return Response.json({});};
 try{const {WorkTasksPage}=await import('../app/client/WorkTasksPage');await act(async()=>{f.root.render(<WorkTasksPage actor={actor} onOpenArchive={()=>{}}/>);});const toggle=f.w.document.querySelector('.work-task-history > button') as HTMLButtonElement;assert.ok(toggle);await act(async()=>{toggle.click();await new Promise(resolve=>setTimeout(resolve,20));});assert.ok((f.w.document.body.textContent??'').includes('修改任务'));assert.ok((f.w.document.body.textContent??'').includes('标题：旧标题 → 新标题'));assert.ok((f.w.document.body.textContent??'').includes('编辑历史（2）'));assert.ok([...f.w.document.querySelectorAll('.work-task-comment footer button')].some(button=>button.textContent==='编辑'));assert.ok((f.w.document.body.textContent??'').includes('观察版本 1'));
 }finally{await f.close();}
});
