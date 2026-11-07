import {bucketDate,shanghaiDate,type StatisticsQuery,type StatisticsResult} from './statistics.ts';
import {backlogForecast,resourceDistribution,experienceTypes,type WorkOverviewData} from './work-overview.ts';

export type WeeklyReportData={generated_at:string;from:string;to:string;statistics:StatisticsResult;overview:WorkOverviewData};
export function weeklyReportQuery(date=new Date(),scope:Pick<StatisticsQuery,'group'|'archive_type'>={group:'user',archive_type:'all'}):StatisticsQuery{
 const to=shanghaiDate(date);return {from:bucketDate(to,'week'),to,interval:'day',search:'',group:scope.group,archive_type:scope.archive_type};
}
export function statisticsQueryFromSearch(search:string):StatisticsQuery|undefined{
 const params=new URLSearchParams(search);if(!params.has('from')||!params.has('to'))return undefined;
 const from=params.get('from')!,to=params.get('to')!;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return undefined;
 return {from,to,group:(['user','tag','type'].includes(params.get('group')??'')?params.get('group'):'user') as StatisticsQuery['group'],interval:(['day','week','month'].includes(params.get('interval')??'')?params.get('interval'):'day') as StatisticsQuery['interval'],archive_type:(['all','person','org'].includes(params.get('archive_type')??'')?params.get('archive_type'):'all') as StatisticsQuery['archive_type'],search:(params.get('search')??'').slice(0,100)};
}

export type WeeklyReportFormat='pdf'|'json';
/** Self-describing, versioned interchange format. IDs retain source relationships. */
export function weeklyReportDocument(data:WeeklyReportData){
 const {overview,statistics}=data;
 return {
  schema_version:'1.0.0',report_type:'weekly_work_overview',generated_at:data.generated_at,
  timezone:'Asia/Shanghai',period:{from:data.from,to:data.to,week_starts_on:'Monday',end_inclusive:true},
  scope:{archive_type:statistics.query.archive_type,group_by:statistics.query.group,temporary_search_applied:false,resources:'all_internal_resources'},
  definitions:{observation_body:'经历中的 observation.body 是最多 300 字的摘要；通过 observation.id 与 content_version 定位原始观察，不能当作全文。',submission_trend:'按观察首次提交时间统计本周至生成时刻；排除草稿及已删除记录。组内去重，跨组可重叠，total 单独去重。',admission_progress:'当前开启档案；人物仅含未正式入社者，组织单独标注。经历按实际业务状态切换分段。',resources:'生成时当前社内资源；组合用途单列，白色占位补齐后按实际资源 ID 去重。',follow_up:'最新新增观察后 30 天到期；无观察时从建档计时。未更新者在到期后每一天继续计入，日间合计不可相加当作独立人数。',null_capacity:'未知，不能作为零；known_capacity 只含已填写容量。',snapshot:'进度、资源、预测是当前快照，不是本周新增或历史周末状态。'},
  units:{duration_days:'day',resource_count:'resource',known_capacity:'person',unknown_capacity_count:'resource',forecast_total:'archive'},
  experience_types:experienceTypes,
  charts:{
   submission_trend:statistics,
   admission_progress:{as_of:overview.as_of,people:overview.people.filter(p=>p.type==='org'||(p.person_role!=='member'&&p.status!=='已入伙'))},
   internal_resources:{as_of:overview.as_of,distribution:resourceDistribution(overview.resources,overview.white_resources).map(g=>({id:g.id,label:g.label,color:g.color,resource_count:g.count,known_capacity:g.capacity,unknown_capacity_count:g.unknown})),resources:overview.resources,white_resources:overview.white_resources??[],gaps:overview.gaps},
   follow_up_forecast:{as_of:overview.as_of,threshold_days:30,horizon_days:30,points:backlogForecast(overview.people,overview.as_of).map(f=>{const at=new Date(Date.parse(overview.as_of)+f.day*86400000).toISOString(),due=overview.people.filter(p=>p.due_at<=at);return {...f,at,date:shanghaiDate(new Date(at)),person_count:due.filter(p=>p.type==='person').length,organization_count:due.filter(p=>p.type==='org').length,archive_ids:due.map(p=>p.id)};}),archives:overview.people.map(p=>({id:p.id,name:p.name,type:p.type,status:p.status,last_observation_at:p.last_observation_at,due_at:p.due_at,assignment:p.assignment,owner_name:p.owner_name,tasks:p.tasks}))}
  }
 };
}
