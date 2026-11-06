import {z} from 'zod';
import {type Actor, type Env} from './types.ts';
import {bindingJson, evidenceVisibilitySql} from './tag-state.ts';
import {defaultStatisticsQuery, shiftDate, statisticsDates, type StatisticsResult} from '../shared/statistics.ts';

const date = z.iso.date();
export const statisticsInput = z.object({
  from: date, to: date, group: z.enum(['user','tag','type']).default('user'),
  interval: z.enum(['day','week','month']).default('day'),
  archive_type: z.enum(['all','person','org']).default('all'), search: z.string().trim().max(100).default(''),
}).refine(q => q.from <= q.to, '开始日期不能晚于结束日期')
  .refine(q => (Date.parse(q.to) - Date.parse(q.from)) / 86400000 < 366, '时间范围最多 366 天');

export async function statistics(env: Env, actor: Actor, input: Record<string, string>): Promise<StatisticsResult> {
  const q = statisticsInput.parse({...defaultStatisticsQuery(), ...input});
  // Closed archives use their frozen bindings, as in TagState.summaries. Hidden
  // evidence must not reveal the existence of a tag through aggregate counts.
  const labels = `source AS (
    SELECT b.archive_id,${bindingJson} data_json FROM archives a JOIN archive_tags b ON b.archive_id=a.id
    JOIN tags t ON t.id=b.tag_id JOIN tag_categories c ON c.id=t.category_id WHERE a.deleted=0 AND a.closed=0
    UNION ALL SELECT s.archive_id,s.data_json FROM archives a JOIN archive_tag_snapshots s ON s.archive_id=a.id
    AND s.close_version=a.tag_snapshot_version WHERE a.deleted=0 AND a.closed=1
  ), labels AS (
    SELECT s.archive_id,json_extract(s.data_json,'$.tag_id') tag_id,
      json_extract(s.data_json,'$.category_id') category_id,
      json_extract(s.data_json,'$.category_name') category_name,json_extract(s.data_json,'$.name') tag_name
    FROM source s JOIN tags t ON t.id=json_extract(s.data_json,'$.tag_id')
    JOIN tag_categories c ON c.id=t.category_id
    WHERE t.deleted=0 AND c.deleted=0 AND ${evidenceVisibilitySql("json_extract(s.data_json,'$.evidence')")}
  )`;
  const groupedByLabel = q.group === 'tag';
  const id = {user:'o.author_id', tag:"coalesce(l.tag_id,'untagged')", type:'a.type'}[q.group];
  const name = {user:"m.name||'（@'||m.username||'）'", tag:"coalesce(l.category_name||'：'||l.tag_name,'未标注标签')", type:"CASE a.type WHEN 'person' THEN '人物' ELSE '组织' END"}[q.group];
  const day = "date(o.created_at,'+8 hours')";
  const bucket = q.interval === 'day' ? day : q.interval === 'month' ? "strftime('%Y-%m-01',o.created_at,'+8 hours')" : `date(${day},'-'||((cast(strftime('%w',${day}) AS integer)+6)%7)||' days')`;
  const sql = `WITH ${groupedByLabel ? labels + ',' : ''} records AS (
    SELECT DISTINCT o.id,o.author_id,o.archive_id,${bucket} day,${id} group_id,${name} name
    FROM observations o JOIN archives a ON a.id=o.archive_id JOIN members m ON m.id=o.author_id
    ${groupedByLabel ? 'LEFT JOIN labels l ON l.archive_id=a.id' : ''}
    WHERE o.deleted=0 AND a.deleted=0 AND o.created_at>=? AND o.created_at<?
      ${q.archive_type === 'all' ? '' : 'AND a.type=?'}
  ), filtered AS (SELECT * FROM records WHERE name LIKE ? ESCAPE '\\'),
  totals AS (SELECT group_id,max(name) name,count(DISTINCT id) total FROM filtered GROUP BY group_id),
  chosen AS (SELECT * FROM totals ORDER BY total DESC,name,group_id LIMIT 50),
  daily AS (SELECT r.group_id,r.day,count(DISTINCT r.id) count FROM filtered r JOIN chosen c ON c.group_id=r.group_id GROUP BY r.group_id,r.day),
  lines AS (SELECT c.*, (SELECT json_group_object(day,count) FROM daily d WHERE d.group_id=c.group_id) points FROM chosen c)
  SELECT (SELECT count(DISTINCT id) FROM filtered) total,
    (SELECT count(DISTINCT author_id) FROM filtered) members,
    (SELECT count(DISTINCT archive_id) FROM filtered) archives,
    (SELECT count(*) FROM totals) groups,
    (SELECT json_group_array(json_object('id',group_id,'name',name,'total',total,'points',json(points))) FROM lines) series`;
  const args = [...(groupedByLabel ? [actor.id,actor.role] : []),
    new Date(q.from+'T00:00:00+08:00').toISOString(),new Date(shiftDate(q.to,1)+'T00:00:00+08:00').toISOString(),
    ...(q.archive_type==='all'?[]:[q.archive_type]),'%'+q.search.replace(/[\\%_]/g,'\\$&')+'%'];
  const row = await env.DB.prepare(sql).bind(...args).first<{total:number;members:number;archives:number;groups:number;series:string}>();
  const dates = statisticsDates(q.from,q.to,q.interval);
  const series = JSON.parse(row?.series ?? '[]') as {id:string;name:string;total:number;points:Record<string,number>}[];
  const work=q.archive_type==='org'?undefined:await personnelWork(env,actor,q.from,q.to,labels);
  return {work,query:q,dates,total:row?.total??0,members:row?.members??0,archives:row?.archives??0,groups:row?.groups??0,
    series:series.map(s=>({...s,points:dates.map(d=>s.points[d]??0)}))};
}

async function personnelWork(env:Env,actor:Actor,from:string,to:string,labels:string):Promise<NonNullable<StatisticsResult['work']>>{
 const start=new Date(from+'T00:00:00+08:00').toISOString(),end=new Date(shiftDate(to,1)+'T00:00:00+08:00').toISOString();
 const active=`EXISTS(SELECT 1 FROM json_each(a.resources_json) r JOIN internal_resources ir ON ir.id=json_extract(r.value,'$.internal_resource_id') WHERE json_extract(r.value,'$.usage')='active')`,planned=`EXISTS(SELECT 1 FROM json_each(a.resources_json) r JOIN internal_resources ir ON ir.id=json_extract(r.value,'$.internal_resource_id') WHERE json_extract(r.value,'$.usage')='planned')`,member="(a.person_role='member' OR (a.person_role IS NULL AND a.status='已入伙'))",available="(COALESCE(a.member_status,'可接工作')='可接工作' AND a.member_work_paused=0)";
 const current=await env.DB.prepare(`SELECT count(*) people,coalesce(sum(${member}),0) members,
 coalesce(sum(${member} AND ${available} AND NOT ${active} AND NOT ${planned}),0) waiting,
 coalesce(sum(${member} AND ${available} AND NOT ${active} AND ${planned}),0) planned,
 coalesce(sum(${active}),0) placed,coalesce(sum(${member} AND NOT ${available}),0) unavailable
 FROM archives a WHERE a.type='person' AND a.deleted=0 AND a.closed=0`).bind().first<Record<string,number>>();
 const period=await env.DB.prepare(`WITH events AS (SELECT e.* FROM archive_events e JOIN archives a ON a.id=e.archive_id WHERE a.type='person' AND a.deleted=0 AND e.created_at>=? AND e.created_at<?),
 changed AS (SELECT * FROM events WHERE kind='archive.state_changed' AND json_extract(before_json,'$.status') IS NOT json_extract(after_json,'$.status'))
 SELECT (SELECT count(DISTINCT archive_id) FROM events WHERE kind='archive.created') created,
 (SELECT count(DISTINCT archive_id) FROM changed) phase_changes,
 (SELECT count(DISTINCT archive_id) FROM changed WHERE json_extract(after_json,'$.status')='已加入待对接') audit_passed,
 (SELECT count(DISTINCT archive_id) FROM changed WHERE json_extract(after_json,'$.status')='已入伙') joined,
 (SELECT count(DISTINCT archive_id) FROM events e WHERE e.kind IN('archive.profile_changed','archive.resource_transferred') AND EXISTS(SELECT 1 FROM json_each(e.after_json,'$.resources') r WHERE json_extract(r.value,'$.internal_resource_id') IS NOT NULL AND json_extract(r.value,'$.usage')='active' AND NOT EXISTS(SELECT 1 FROM json_each(e.before_json,'$.resources') old WHERE json_extract(old.value,'$.internal_resource_id')=json_extract(r.value,'$.internal_resource_id') AND json_extract(old.value,'$.usage')='active'))) arrivals,
 (SELECT count(DISTINCT archive_id) FROM events e WHERE e.kind IN('archive.profile_changed','archive.resource_transferred') AND EXISTS(SELECT 1 FROM json_each(e.before_json,'$.resources') r WHERE json_extract(r.value,'$.internal_resource_id') IS NOT NULL AND json_extract(r.value,'$.usage')='active' AND NOT EXISTS(SELECT 1 FROM json_each(e.after_json,'$.resources') next WHERE json_extract(next.value,'$.internal_resource_id')=json_extract(r.value,'$.internal_resource_id') AND json_extract(next.value,'$.usage')='active'))) departures,
 (SELECT count(DISTINCT archive_id) FROM events WHERE kind='archive.resource_transferred') resource_transfers,
 (SELECT count(DISTINCT archive_id) FROM events WHERE kind='archive.closed') closed,
 (SELECT count(*) FROM work_task_events e JOIN work_tasks t ON t.id=e.task_id JOIN archives a ON a.id=t.archive_id WHERE a.type='person' AND a.deleted=0 AND e.kind='task.completed' AND e.created_at>=? AND e.created_at<?) completed_deliveries`).bind(start,end,start,end).first<Record<string,number>>();
 const tags=await env.DB.prepare(`WITH ${labels}, counts AS (SELECT l.tag_id id,max(l.category_name||'：'||l.tag_name) name,count(DISTINCT a.id) people FROM labels l JOIN archives a ON a.id=l.archive_id WHERE a.type='person' AND a.deleted=0 AND a.closed=0 GROUP BY l.tag_id),chosen AS (SELECT * FROM counts ORDER BY people DESC,name,id LIMIT 50) SELECT (SELECT count(*) FROM counts) groups,coalesce((SELECT json_group_array(json_object('id',id,'name',name,'people',people)) FROM chosen),'[]') items`).bind(actor.id,actor.role).first<{groups:number;items:string}>();
 return {current:current??{},period:period??{},tags:JSON.parse(tags?.items??'[]'),tag_groups:tags?.groups??0};
}
