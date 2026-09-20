import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import type {StatisticsQuery,StatisticsResult} from '../app/shared/statistics';

test('statistics ignores late responses after regrouping and clears old values on refresh failures',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true}),w=dom.window;
  for(const key of ['window','document','HTMLElement','Event'])Object.defineProperty(globalThis,key,{value:key==='window'?w:(w as unknown as Record<string,unknown>)[key],configurable:true,writable:true});
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const {createRoot}=await import('react-dom/client');
  const {StatisticsDashboard}=await import('../app/ui/StatisticsDashboard');
  const root=createRoot(w.document.getElementById('root')!);
  const pending:{query:StatisticsQuery;resolve:(result:StatisticsResult)=>void;reject:(error:Error)=>void}[]=[];
  const load=(query:StatisticsQuery)=>new Promise<StatisticsResult>((resolve,reject)=>pending.push({query,resolve,reject}));
  const result=(i:number,name:string):StatisticsResult=>({query:pending[i].query,dates:['2026-09-20'],series:[{id:name,name,total:3,points:[3]}],total:3,members:1,archives:1,groups:1});
  const click=async(text:string)=>act(async()=>{[...w.document.querySelectorAll('button')].find(b=>b.textContent===text)!.click();});
  try{
    await act(async()=>root.render(<StatisticsDashboard load={load}/>));
    await click('标签优先');assert.equal(pending.length,2);
    await act(async()=>pending[1].resolve(result(1,'新标签')));
    await act(async()=>pending[0].resolve(result(0,'旧用户')));
    assert.match(w.document.body.textContent!,/新标签/);assert.doesNotMatch(w.document.body.textContent!,/旧用户/);
    await click('刷新统计');assert.equal(w.document.querySelector('.statistics-summary'),null);
    await act(async()=>pending[2].reject(new Error('网络中断')));
    assert.match(w.document.querySelector('[role=alert]')!.textContent!,/网络中断/);
    await click('重试');await act(async()=>pending[3].resolve(result(3,'恢复后的标签')));
    assert.match(w.document.body.textContent!,/恢复后的标签/);
  }finally{await act(async()=>root.unmount());dom.window.close();}
});
