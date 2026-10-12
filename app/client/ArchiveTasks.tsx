import React,{useEffect,useRef,useState} from 'react';
import {api,type Member} from './api';
import {PageError} from './ConnectionPages';
import {TaskIndexItem,TaskDetailModal,type Task,type ArchivePreview} from './WorkTasksPage';
import {RelatedTasksFrame} from '../ui/TaskBook';

export function ArchiveTasks({archiveId,archiveVersion,actor,onChanged,onOpenArchive}:{archiveId:string;archiveVersion:number;actor:Member;onChanged:()=>void;onOpenArchive:(archive:ArchivePreview,taskId:string,observationId?:string,contentVersion?:number)=>void}){
 const[history,setHistory]=useState(false),[tasks,setTasks]=useState<Task[]>([]),[next,setNext]=useState<number|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState<Task|null>(null);
 const sequence=useRef(0),selection=useRef<string|null>(null),failedOffset=useRef(0),detailSequence=useRef(0);
 async function load(offset=0){
  const current=++sequence.current;setLoading(true);setError('');failedOffset.current=offset;
  try{const r=await api<{tasks:Task[];next_offset:number|null}>('/work-tasks?'+new URLSearchParams({archive_id:archiveId,scope:'all',state:history?'closed':'open',offset:String(offset),limit:'50'}));
   if(current!==sequence.current)return;setTasks(old=>offset?[...old,...r.tasks.filter(t=>!old.some(o=>o.id===t.id))]:r.tasks);setNext(r.next_offset);
  }catch(e){if(current===sequence.current)setError((e as Error).message);}finally{if(current===sequence.current)setLoading(false);}
 }
 useEffect(()=>{setTasks([]);setNext(null);setSelected(null);selection.current=null;},[archiveId,history]);
 useEffect(()=>{void load();return()=>{sequence.current++;};},[archiveId,history,archiveVersion]);
 useEffect(()=>()=>{selection.current=null;detailSequence.current++;},[]);
 function choose(task:Task|null){selection.current=task?.id??null;setSelected(task);}
 async function changed(){
  const current=++detailSequence.current,original=selected;void load();onChanged();if(!original)return;
  try{const r=await api<{task:Task}>('/work-tasks/'+original.id);if(current===detailSequence.current&&selection.current===original.id)setSelected({...original,...r.task,owner_name:r.task.owner_id===actor.id?actor.name:r.task.owner_id===original.owner_id?original.owner_name:null,owner_version:r.task.owner_id===actor.id?actor.version:original.owner_version});}
  catch(e){if(current===detailSequence.current&&selection.current===original.id){setError((e as Error).message);choose(null);}}
 }
 return <RelatedTasksFrame history={history} onHistory={setHistory} onRefresh={()=>{void load();onChanged();}}>
  <PageError error={error} retry={()=>void load(failedOffset.current)}/>
  {tasks.map(task=><TaskIndexItem key={task.id} task={task} actor={actor} selected={selected?.id===task.id} onSelect={()=>choose(task)}/>)}
  {loading?<p className="stream-status" role="status">正在读取关联任务…</p>:!error&&(!tasks.length?<p className="stream-status">{history?'暂无已关闭的关联任务':'暂无开启中的关联任务'}</p>:next!==null&&<button className="button" onClick={()=>void load(next)}>加载更多任务</button>)}
  {selected&&<TaskDetailModal task={selected} actor={actor} onChanged={()=>void changed()} onOpenArchive={(...args)=>{choose(null);onOpenArchive(...args);}} onClose={()=>choose(null)}/>}
 </RelatedTasksFrame>;
}
