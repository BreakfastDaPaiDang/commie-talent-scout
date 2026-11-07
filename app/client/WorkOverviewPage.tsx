import type {RecommendationAPI,RecommendationData} from '../shared/work-recommendations';
import React from 'react';
import type {ObservationDraft} from '../ui/WorkOverviewDetail';
import {api} from './api';
import {mutate} from './mutations';
import {WorkOverview,type OverviewSave} from '../ui/WorkOverview';
import type {WorkOverviewData,OverviewPerson} from '../shared/work-overview';
export const loadOverview=(type:'all'|'person'|'org')=>api<WorkOverviewData>('/work-overview?type='+type);
export const saveOverview=(input:OverviewSave)=>mutate(input.entity==='resource'||input.entity==='resource_delete'?'/resources/save':'/work-overview/save',input);
export const observeOverview=(input:ObservationDraft)=>mutate('/observations/create',input);
const path=(p:OverviewPerson)=>(p.type==='org'?'/organizations':p.person_role==='member'?'/members':'/')+'?archive='+p.id;
export const overviewRecommendations:RecommendationAPI={load:(id,observation)=>api<RecommendationData>('/work-overview/recommendations?archive_id='+id+(observation?'&observation_id='+observation:'')),accept:input=>mutate('/work-tasks/create',input) as Promise<{id:string;reused?:boolean}>};
export function WorkOverviewPage({navigate}:{navigate:(url:string)=>void}){return <WorkOverview recommendations={overviewRecommendations} load={loadOverview} save={saveOverview} observe={observeOverview} onArchive={p=>navigate(path(p))} onTask={id=>navigate('/tasks?task='+id)} onCreateTask={(p,specific)=>navigate('/tasks?create_for='+p.id+(specific?'&work=specific':''))}/>;}
