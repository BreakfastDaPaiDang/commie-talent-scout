export type StatisticsGroup = 'user' | 'tag' | 'type';
export type StatisticsInterval = 'day' | 'week' | 'month';
export type StatisticsQuery = {
  from: string; to: string; group: StatisticsGroup; interval: StatisticsInterval;
  archive_type: 'all' | 'person' | 'org'; search: string;
};
export type StatisticsSeries = {id: string; name: string; total: number; points: number[]};
export type StatisticsResult = {
  work?:{current:Record<string,number>;period:Record<string,number>;tags:{id:string;name:string;people:number}[];tag_groups:number};
  query: StatisticsQuery; dates: string[]; series: StatisticsSeries[];
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

export type StatisticsView=StatisticsQuery&{selected:string[]|null;cumulative:boolean};
export function readStatisticsView(params:URLSearchParams):StatisticsView{
 const defaults=defaultStatisticsQuery(),get=(k:string)=>params.get('s_'+k);
 const validDate=(v:string|null)=>!!v&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
 let from=get('from'),to=get('to');if(!validDate(from)||!validDate(to)||from!>to!||Date.parse(to!)-Date.parse(from!)>=366*86400000){from=defaults.from;to=defaults.to;}
 let selected:string[]|null=null;try{const v=JSON.parse(get('selected')??'null');if(Array.isArray(v)&&v.length<=50&&v.every(id=>typeof id==='string'&&id.length<160))selected=v;}catch{}
 const group=get('group'),interval=get('interval'),type=get('archive_type');
 return {from:from!,to:to!,group:group==='tag'||group==='type'?group:'user',interval:interval==='week'||interval==='month'?interval:'day',archive_type:type==='person'||type==='org'?type:'all',search:(get('search')??'').slice(0,100),selected,cumulative:get('cumulative')==='1'};
}
export function writeStatisticsView(params:URLSearchParams,view:StatisticsView){for(const key of ['from','to','group','interval','archive_type','search'] as const)params.set('s_'+key,view[key]);if(view.selected===null)params.delete('s_selected');else params.set('s_selected',JSON.stringify(view.selected));params.set('s_cumulative',view.cumulative?'1':'0');}
export function statisticsViewQuery(view:StatisticsView):StatisticsQuery{const {selected,cumulative,...q}=view;return q;}
