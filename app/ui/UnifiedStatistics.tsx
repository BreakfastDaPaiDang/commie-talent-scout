import type {WeeklyReportFormat} from '../shared/weekly-report';
import React from 'react';
import {StatisticsDashboard} from './StatisticsDashboard';
import {WorkOverview,type WorkOverviewProps} from './WorkOverview';
import type {StatisticsQuery,StatisticsResult} from '../shared/statistics';

export type UnifiedStatisticsProps={work:WorkOverviewProps;loadStatistics:(query:StatisticsQuery)=>Promise<StatisticsResult>;getLink?:()=>Promise<string>;exportWeekly?:(query:StatisticsQuery,format:WeeklyReportFormat,target:Window|null)=>Promise<void>;initialStatistics?:StatisticsResult;initialQuery?:StatisticsQuery;report?:boolean};
export function UnifiedStatistics({work,loadStatistics,getLink,exportWeekly,initialStatistics,initialQuery,report=false}:UnifiedStatisticsProps){
 return <StatisticsDashboard load={loadStatistics} getLink={getLink} exportWeekly={exportWeekly} initialData={initialStatistics} initialQuery={initialQuery} report={report} renderCharts={(trend,state)=><WorkOverview {...work} embedded report={report} externalScope={state.archiveType} externalRevision={state.revision} trend={trend} onObservationSaved={state.refresh}/>}/>;
}
