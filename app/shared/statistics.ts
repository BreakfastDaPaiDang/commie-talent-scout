export type StatisticsGroup = 'user' | 'tag' | 'type';
export type StatisticsInterval = 'day' | 'week' | 'month';
export type StatisticsQuery = {
  from: string; to: string; group: StatisticsGroup; interval: StatisticsInterval;
  archive_type: 'all' | 'person' | 'org'; search: string;
};
export type StatisticsSeries = {id: string; name: string; total: number; points: number[]};
export type StatisticsResult = {
  viewer_id?: string; query: StatisticsQuery; dates: string[]; series: StatisticsSeries[];
  total: number; members: number; archives: number; groups: number;
};
export function shanghaiDate(date = new Date()) {return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);}
export function shiftDate(date: string, days: number) {return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);}
export function bucketDate(date: string, interval: StatisticsInterval) {
  if (interval === 'month') return date.slice(0, 7) + '-01';
  if (interval === 'week') return shiftDate(date, -((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7));
  return date;
}
export function statisticsDates(from: string, to: string, interval: StatisticsInterval) {
  const dates = new Set<string>();
  for (let date = from; date <= to; date = shiftDate(date, 1)) dates.add(bucketDate(date, interval));
  return [...dates];
}
export function defaultStatisticsQuery(): StatisticsQuery {
  const to = shanghaiDate();
  return {from: shiftDate(to, -29), to, group: 'user', interval: 'day', archive_type: 'all', search: ''};
}

export function defaultComparison(data:StatisticsResult):string[]{
 if(data.query.group!=='user')return data.series.slice(0,3).map(s=>s.id);
 const own=data.series.find(s=>s.id===data.viewer_id);
 return [...(own?[own.id]:[]),...data.series.filter(s=>s.id!==data.viewer_id).slice(0,3).map(s=>s.id)];
}
export function ownFirst(data:StatisticsResult){return data.query.group==='user'?[...data.series].sort((a,b)=>Number(b.id===data.viewer_id)-Number(a.id===data.viewer_id)):data.series;}
