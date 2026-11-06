import React from 'react';
import {api} from './api';
import {WorkOverview,type OverviewSave} from '../ui/WorkOverview';
import type {WorkOverviewData,OverviewPerson} from '../shared/work-overview';
const load=(type:'person'|'org')=>api<WorkOverviewData>('/work-overview?type='+type);
const attempts=new Map<string,string>();
async function save(input:OverviewSave){const key=JSON.stringify(input),request_id=attempts.get(key)??crypto.randomUUID();attempts.set(key,request_id);try{const result=await api('/work-overview/save',{...input,request_id});attempts.delete(key);return result;}catch(error){const receipt=await api<{status:string;result:unknown}>('/commands/'+request_id).catch(()=>null);if(receipt?.status==='completed'){attempts.delete(key);return receipt.result;}throw error;}}
const path=(p:OverviewPerson)=>(p.type==='org'?'/organizations':p.person_role==='member'?'/members':'/')+'?archive='+p.id;
export function WorkOverviewPage({navigate}:{navigate:(url:string)=>void}){return <WorkOverview load={load} save={save} onArchive={p=>navigate(path(p))} onTask={id=>navigate('/tasks?task='+id)} onCreateTask={p=>navigate('/tasks?create_for='+p.id)}/>;}
