import React from 'react';
import type {ObservationDraft} from '../ui/WorkOverviewDetail';
import {api,ApiError} from './api';
import {WorkOverview,type OverviewSave} from '../ui/WorkOverview';
import type {WorkOverviewData,OverviewPerson} from '../shared/work-overview';
const load=(type:'person'|'org')=>api<WorkOverviewData>('/work-overview?type='+type);
const attempts=new Map<string,string>();
async function mutate(path:string,input:object){const key=path+JSON.stringify(input),request_id=attempts.get(key)??crypto.randomUUID();attempts.set(key,request_id);try{const result=await api(path,{...input,request_id});attempts.delete(key);return result;}catch(error){const receipt=await api<{status:string;result:unknown}>('/commands/'+request_id).catch(()=>null);if(receipt?.status==='completed'){attempts.delete(key);return receipt.result;}if(error instanceof ApiError&&error.status<500){attempts.delete(key);throw error;}throw Object.assign(error instanceof Error?error:new Error(String(error)),{retryOnly:true});}}
const save=(input:OverviewSave)=>mutate('/work-overview/save',input);
const observe=(input:ObservationDraft)=>mutate('/observations/create',input);
const path=(p:OverviewPerson)=>(p.type==='org'?'/organizations':p.person_role==='member'?'/members':'/')+'?archive='+p.id;
export function WorkOverviewPage({navigate}:{navigate:(url:string)=>void}){return <WorkOverview load={load} save={save} observe={observe} onArchive={p=>navigate(path(p))} onTask={id=>navigate('/tasks?task='+id)} onCreateTask={(p,specific)=>navigate('/tasks?create_for='+p.id+(specific?'&work=specific':''))}/>;}
