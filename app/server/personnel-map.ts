import {InternalResources} from './internal-resources.ts';
import {z} from 'zod';
import {buildPersonnelMap,type MapArchive,type MapTransfer} from '../shared/personnel-map.ts';
import {projectResources} from './archive-resources.ts';
import type {ResourceValue} from '../shared/archive-resources.ts';
import {archiveReminder} from '../rules/archive-reminders.ts';
import type {Actor,Env} from './types.ts';
export const personnelMapInput=z.object({days:z.coerce.number().int().min(1).max(365).default(30),query:z.string().trim().max(120).default('')});
export async function personnelMap(env:Env,actor:Actor,input:unknown){
 const a=personnelMapInput.parse(input),at=Date.now(),cutoff=new Date(at-a.days*86400000).toISOString(),query='%'+a.query.replace(/[\\%_]/g,'\\$&')+'%',filter=`a.type='person' AND a.deleted=0 AND a.closed=0 AND (?='' OR a.name LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM json_each(a.resources_json) entry JOIN internal_resources ir ON ir.id=json_extract(entry.value,'$.internal_resource_id') WHERE ir.name LIKE ? ESCAPE '\\' OR ir.type LIKE ? ESCAPE '\\') OR EXISTS(SELECT 1 FROM json_each(a.resources_json) legacy LEFT JOIN archives target ON target.id=json_extract(legacy.value,'$.archive_id') WHERE json_extract(legacy.value,'$.internal_resource_id') IS NULL AND (json_extract(legacy.value,'$.archive_id') IS NULL OR target.deleted=0) AND (json_extract(legacy.value,'$.name') LIKE ? ESCAPE '\\' OR target.name LIKE ? ESCAPE '\\' OR json_extract(legacy.value,'$.type') LIKE ? ESCAPE '\\')))`;
 const filterArgs=[a.query,query,query,query,query,query,query];
 type Row=Omit<MapArchive,'resources'|'overdue'|'closed'|'members'>&{resources_json:string;members_json:string;closed:number;updated_at:string;deleted:number};
 const rows=await env.DB.prepare(`SELECT a.id,a.name,a.type,a.status,a.person_role,a.closed,a.deleted,a.version,a.current_need,a.resources_json,a.updated_at,
  COALESCE((SELECT max(e.created_at) FROM archive_events e WHERE e.archive_id=a.id AND e.kind IN('archive.created','archive.state_changed','archive.reopened')),a.created_at) stage_since,
  (SELECT count(*) FROM work_tasks t WHERE t.archive_id=a.id AND t.status='open') open_tasks,
  (SELECT count(*) FROM work_tasks t WHERE t.archive_id=a.id AND t.status='open' AND t.owner_id IS NULL) unassigned_tasks,
  (SELECT count(*) FROM work_tasks t WHERE t.archive_id=a.id AND t.status='open' AND t.deadline_at<?) overdue_tasks,
  (SELECT count(*) FROM materials m WHERE m.archive_id=a.id AND m.state='ready' AND m.deleted_at IS NULL) materials,
  (SELECT count(*) FROM observations o WHERE o.archive_id=a.id AND o.deleted=0) observations,
  (SELECT json_group_array(json_object('id',m.id,'name',m.name)) FROM archive_bindings b JOIN members m ON m.id=b.member_id WHERE b.archive_id=a.id AND b.status=a.status) members_json
 FROM archives a WHERE ${filter} ORDER BY a.id LIMIT 1001`).bind(new Date(at).toISOString(),...filterArgs).all<Row>();
 const total=await env.DB.prepare(`SELECT count(*) n FROM archives a WHERE ${filter}`).bind(...filterArgs).first<number>('n'),page=rows.results.slice(0,1000);
 const resources=await projectResources(env,page.flatMap(r=>JSON.parse(r.resources_json) as ResourceValue[]));let offset=0;
 const archives:MapArchive[]=page.map(r=>{const count=(JSON.parse(r.resources_json) as unknown[]).length,values=resources.slice(offset,offset+count);offset+=count;const {resources_json,members_json,updated_at,deleted,...rest}=r;return {...rest,closed:!!r.closed,resources:values,members:JSON.parse(members_json??'[]'),overdue:archiveReminder({...r,closed:!!r.closed,deleted:!!r.deleted},at)?.overdue??false};});
 // A transfer is a recorded state change. Resolve the resource snapshot that existed then,
 // rather than projecting today's assignments backwards onto historical movements.
 const history=await env.DB.prepare(`SELECT e.archive_id,e.created_at at,json_extract(e.before_json,'$.status') before,json_extract(e.after_json,'$.status') after,
  COALESCE((SELECT json_extract(p.after_json,'$.resources') FROM archive_events p WHERE p.archive_id=e.archive_id AND p.seq<=e.seq AND p.kind IN('archive.created','archive.profile_changed') AND json_type(p.after_json,'$.resources')='array' ORDER BY p.seq DESC LIMIT 1),'[]') resources_json
 FROM archive_events e JOIN archives a ON a.id=e.archive_id WHERE ${filter} AND a.type='person' AND e.kind='archive.state_changed' AND e.created_at>=? ORDER BY e.seq DESC LIMIT 2001`).bind(...filterArgs,cutoff).all<{archive_id:string;at:string;before:string;after:string;resources_json:string}>();
 const historyPage=history.results.slice(0,2000),snapshots=await projectResources(env,historyPage.flatMap(r=>JSON.parse(r.resources_json) as ResourceValue[]));offset=0;
 const transfers:MapTransfer[]=historyPage.map(r=>{const count=(JSON.parse(r.resources_json) as unknown[]).length,result={...r,resources:snapshots.slice(offset,offset+count)};offset+=count;return result;});
 const all=await new InternalResources(env,actor,'web').all(),linkedIds=new Set([...archives.flatMap(a=>a.resources.flatMap(r=>!r.restricted&&r.internal_resource_id?[r.internal_resource_id]:[])),...transfers.flatMap(t=>t.resources.flatMap(r=>!r.restricted&&r.internal_resource_id?[r.internal_resource_id]:[]))]),term=a.query.toLowerCase(),inventory=all.filter(r=>!term||linkedIds.has(r.id)||(r.name+' '+r.type).toLowerCase().includes(term));
 return buildPersonnelMap(archives,transfers,{internal_resources:inventory,days:a.days,complete:rows.results.length<=1000,history_complete:history.results.length<=2000,total_archives:total??0});
}
