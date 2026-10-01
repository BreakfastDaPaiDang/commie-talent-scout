import React,{useState} from 'react';
import {FlowWorkspace} from '../../../app/ui/FlowWorkspace';
import type {FlowAction,FlowPage} from '../../../app/ui/flow-types';
import {StatisticsPreview} from './StatisticsPreview.jsx';
import {advanceFlow,applyFlow,flowActors,initialFlow} from './flow-model';

export default function FlowPreview(){
 const[data,setData]=useState(initialFlow),[actorId,setActorId]=useState('zhou'),[page,setPage]=useState<FlowPage>('tasks'),[selected,setSelected]=useState<string|null>('p1'),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const actor=flowActors.find(a=>a.id===actorId)!;
 function action(a:FlowAction){try{const next=applyFlow(data,a,actor);setData(next);setError('');if(a.type==='join'){setPage('members');setSelected(a.personId);setNotice('已转入社员档案 · 入社对接等待领取');}else if(a.type==='release')setNotice('已交还任务，等待其他成员接手');else if(a.type==='complete')setNotice('已完成当前工作，结果与历史已保留');else if(a.type==='claim')setNotice(`${actor.name}已接手，下一步由你推进`);else if(a.type!=='read')setNotice('已保存本次操作');return true;}catch(e){setError((e as Error).message);return false;}}
 function reset(){setData(initialFlow());setPage('tasks');setSelected('p1');setNotice('演示已重置');setError('');}
 return <FlowWorkspace data={data} actor={actor} actors={flowActors} page={page} onPage={p=>{setPage(p);setNotice('');setError('');}} selectedId={selected} onSelect={id=>{setSelected(id);setError('');}} onAction={action} notice={notice} error={error} statistics={<StatisticsPreview/>} controls={<div className="fw-demo"><span><b>交互原型</b> 虚构数据 · 刷新复位</span><div><label>演示身份<select aria-label="演示身份" value={actorId} onChange={e=>{setActorId(e.target.value);setError('');setNotice('');}}>{flowActors.map(a=><option key={a.id} value={a.id}>{a.name}{a.role==='admin'?' · 管理员':''}</option>)}</select></label><button onClick={()=>{setData(advanceFlow(data));setNotice('演示时间已前进一天，到期任务已处理');}}>推进一天</button><button onClick={reset}>重置演示</button><a href="/">现有原型</a></div></div>}/>;
}
