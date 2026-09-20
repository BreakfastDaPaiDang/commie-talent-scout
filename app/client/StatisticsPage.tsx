import React from 'react';
import {api} from './api';
import {StatisticsDashboard} from '../ui/StatisticsDashboard';
import type {StatisticsQuery,StatisticsResult} from '../shared/statistics';

const load = (query:StatisticsQuery) => api<StatisticsResult>('/statistics?'+new URLSearchParams(query));
const getLink = () => api<{url:string}>('/statistics/link').then(r=>r.url);
export function StatisticsPage(){return <StatisticsDashboard load={load} getLink={getLink}/>;}
