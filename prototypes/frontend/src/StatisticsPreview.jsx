import React from 'react';
import {StatisticsDashboard} from '../../../app/ui/StatisticsDashboard';
import {statisticsDates,bucketDate,shanghaiDate,shiftDate} from '../../../app/shared/statistics';

// Fictional, deterministic statistics for the shared UI preview only.
export async function loadStatisticsPreview(query) {
  if(!query.from||!query.to||query.from>query.to||Date.parse(query.to)-Date.parse(query.from)>=366*86400000)throw new Error('请选择不超过 366 天的有效日期范围');
  const dates=statisticsDates(query.from,query.to,query.interval),today=shanghaiDate(),grouped=new Map(),counted=new Set(),members=new Set(),archives=new Set();
  for(let i=0;i<180;i++){
    const day=shiftDate(today,-(i%60)),type=i%4===0?'org':'person';
    if(day<query.from||day>query.to||(query.archive_type!=='all'&&query.archive_type!==type))continue;
    const member=['周宁（@zhouning）','沈舟（@shenzhou）','许禾（@xuhe）'][i%3];
    const labels=type==='org'?['已有能力：内容制作']:i%2?['技能：视频剪辑','技能：资料整理']:['协作方式：稳定参与'];
    const names=[...new Set(query.group==='user'?[member]:query.group==='type'?[type==='person'?'人物':'组织']:labels)];
    for(const name of names.filter(n=>n.includes(query.search))){
      const line=grouped.get(name)??{id:name,name,total:0,points:dates.map(()=>0)};
      line.total++;line.points[dates.indexOf(bucketDate(day,query.interval))]++;grouped.set(name,line);
      counted.add(i);members.add(member);archives.add(i%8);
    }
  }
  const series=[...grouped.values()].sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
  return {query,dates,series,total:counted.size,members:members.size,archives:archives.size,groups:series.length};
}
export function StatisticsPreview(){return <StatisticsDashboard load={loadStatisticsPreview} getLink={async()=>location.origin+'/statistics'}/>;}
