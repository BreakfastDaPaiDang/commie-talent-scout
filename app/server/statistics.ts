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
  return {query:q,dates,total:row?.total??0,members:row?.members??0,archives:row?.archives??0,groups:row?.groups??0,
    series:series.map(s=>({...s,points:dates.map(d=>s.points[d]??0)}))};
}
