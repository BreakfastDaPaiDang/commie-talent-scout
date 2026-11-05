import React,{useEffect,useRef,useState} from 'react';
import {api,ApiError} from './api';
import {TaskObservationEntry} from '../ui/TaskObservationEntry';

export type TaskObservation={id:string;content_version:number;author_name:string;created_at:string;body:string;deleted:boolean};
type Created={id:string;content_version:number};
export function TaskObservationComposer({archiveId,initialBody,onCreated,onBusyChange,disabled=false}:{archiveId:string;initialBody:string;onCreated:(observation:TaskObservation)=>void;onBusyChange:(busy:boolean)=>void;disabled?:boolean}){
 const[open,setOpen]=useState(false),[body,setBody]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[locked,setLocked]=useState(false);
 const pending=useRef<{requestId:string;body:string;saved?:Created}|null>(null),working=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 function toggle(value:boolean){if(value&&!body&&!pending.current)setBody(initialBody);setOpen(value);}
 async function save(){
  if(disabled||working.current||!body.trim())return;
  working.current=true;setBusy(true);onBusyChange(true);setError('');
  const retry=!!pending.current,attempt=pending.current??{requestId:crypto.randomUUID(),body:body.trim()};pending.current=attempt;setLocked(true);
  try{
   if(retry&&!attempt.saved){const receipt=await api<{status:string;result:Created|null}>('/commands/'+attempt.requestId);if(receipt.status==='completed'&&receipt.result)attempt.saved=receipt.result;}
   if(!attempt.saved)attempt.saved=await api<Created>('/observations/create',{archive_id:archiveId,body:attempt.body,request_id:attempt.requestId});
   const result=await api<{observation:TaskObservation}>('/observations/'+attempt.saved.id);
   if(!mounted.current)return;
   onCreated(result.observation);pending.current=null;setLocked(false);setBody('');setOpen(false);
  }catch(e){
   if(!mounted.current)return;
   if(e instanceof ApiError&&e.status<500&&!attempt.saved){pending.current=null;setLocked(false);}
   setError(attempt.saved?'观察已保存，读取引用暂未完成；重试会引用同一条观察。':(e as Error).message);
  }finally{working.current=false;if(mounted.current)setBusy(false);onBusyChange(false);}
 }
 return <TaskObservationEntry open={open} onOpen={toggle} body={body} onBody={setBody} busy={busy||disabled} locked={locked} error={error} onSave={()=>void save()}/>;
}
