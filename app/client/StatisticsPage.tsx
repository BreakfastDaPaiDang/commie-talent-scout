import React from 'react';
import {api} from './api';
import {StatisticsDashboard} from '../ui/StatisticsDashboard';
import type {StatisticsQuery,StatisticsResult} from '../shared/statistics';

const load = (query:StatisticsQuery) => api<StatisticsResult>('/statistics?'+new URLSearchParams(query));
const getLink = () => api<{url:string}>('/statistics/link').then(r=>r.url);
export function StatisticsPage(){return <><nav className="account-content" aria-label="统计页面"><a href="/statistics" aria-current="page">统计概览</a>　<a href="/statistics/work">工作总览</a></nav><StatisticsDashboard load={load} getLink={getLink}/></>;}
