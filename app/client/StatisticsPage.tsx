import React from 'react';
import {api} from './api';
import {UnifiedStatistics} from '../ui/UnifiedStatistics';
import {statisticsQueryFromSearch,type WeeklyReportFormat,type WeeklyReportData} from '../shared/weekly-report';
import {loadOverview,saveOverview,observeOverview,overviewRecommendations} from './WorkOverviewPage';
import type {StatisticsQuery,StatisticsResult} from '../shared/statistics';
import type {OverviewPerson} from '../shared/work-overview';
const load=(query:StatisticsQuery)=>api<StatisticsResult>('/statistics?'+new URLSearchParams(query));
const getLink=()=>api<{url:string}>('/statistics/link').then(r=>r.url);
async function exportWeekly(query:StatisticsQuery,format:WeeklyReportFormat,target:Window|null){const data=await api<WeeklyReportData>('/statistics/weekly-report?'+new URLSearchParams({group:query.group,archive_type:query.archive_type}));const {downloadWeeklyReport}=await import('../ui/WeeklyReport');await downloadWeeklyReport(data,format,target);}
const path=(p:OverviewPerson)=>(p.type==='org'?'/organizations':p.person_role==='member'?'/members':'/')+'?archive='+p.id;
export function StatisticsPage({navigate}:{navigate:(url:string)=>void}){return <UnifiedStatistics loadStatistics={load} getLink={getLink} exportWeekly={exportWeekly} initialQuery={statisticsQueryFromSearch(location.search)} work={{load:loadOverview,save:saveOverview,observe:observeOverview,recommendations:overviewRecommendations,onArchive:p=>navigate(path(p)),onTask:id=>navigate('/tasks?task='+id),onCreateTask:(p,specific)=>navigate('/tasks?create_for='+p.id+(specific?'&work=specific':''))}}/>;}
