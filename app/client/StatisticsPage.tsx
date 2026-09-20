import React from 'react';
import {api} from './api';
import {StatisticsDashboard} from '../ui/StatisticsDashboard';
import type {StatisticsQuery,StatisticsResult} from '../shared/statistics';

const load = (query:StatisticsQuery) => api<StatisticsResult>('/statistics?'+new URLSearchParams(query));
export function StatisticsPage(){return <StatisticsDashboard load={load}/>;}
