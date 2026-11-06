import {InternalResources} from './internal-resources.ts';
import {z} from 'zod';
import {buildPersonnelMap,type MapArchive,type MapTransfer,type MapMovement} from '../shared/personnel-map.ts';
import {projectResources} from './archive-resources.ts';
import type {ResourceValue} from '../shared/archive-resources.ts';
import {archiveReminder} from '../rules/archive-reminders.ts';
import {effectiveMemberStatus} from '../rules/archive-states.ts';
import type {Actor,Env} from './types.ts';
export const personnelMapInput=z.object({days:z.coerce.number().int().min(1).max(365).default(30),query:z.string().trim().max(120).default('')});
// Search projected, readable resource identities; deleted contact targets stay opaque.
function resourceMatch(json:string){return `EXISTS(SELECT 1 FROM json_each(${json}) entry LEFT JOIN internal_resources ir ON ir.id=json_extract(entry.value,'$.internal_resource_id') LEFT JOIN archives target ON target.id=json_extract(entry.value,'$.archive_id') WHERE (ir.id IS NOT NULL AND (ir.name LIKE ? ESCAPE '\\' OR ir.type LIKE ? ESCAPE '\\')) OR (json_extract(entry.value,'$.internal_resource_id') IS NULL AND (json_extract(entry.value,'$.archive_id') IS NULL OR target.deleted=0) AND (json_extract(entry.value,'$.name') LIKE ? ESCAPE '\\' OR target.name LIKE ? ESCAPE '\\' OR json_extract(entry.value,'$.type') LIKE ? ESCAPE '\\')))`;}
const stageSince=`COALESCE((SELECT CASE WHEN json_extract(e.after_json,'$.status')=a.status THEN e.created_at END FROM archive_events e WHERE e.archive_id=a.id AND (e.kind IN('archive.created','archive.reopened') OR (e.kind='archive.state_changed' AND json_extract(e.before_json,'$.status') IS NOT json_extract(e.after_json,'$.status'))) ORDER BY e.seq DESC LIMIT 1),'')`;
const snapshot=`COALESCE((SELECT json_extract(p.after_json,'$.resources') FROM archive_events p WHERE p.archive_id=e.archive_id AND p.seq<=e.seq AND json_type(p.after_json,'$.resources')='array' AND p.kind IN('archive.created','archive.profile_changed','archive.resource_transferred') ORDER BY p.seq DESC LIMIT 1),'[]')`;
type Row=Omit<MapArchive,'resources'|'overdue'|'closed'|'members'>&{resources_json:string;members_json:string;closed:number;updated_at:string;deleted:number;member_work_paused:number};
export async function personnelMap(env:Env,actor:Actor,input:unknown){
 const a=personnelMapInput.parse(input),at=Date.now(),cutoff=new Date(at-a.days*86400000).toISOString(),query='%'+a.query.replace(/[\\%_]/g,'\\$&')+'%',filter=`a.type='person' AND a.deleted=0 AND a.closed=0 AND (?='' OR a.name LIKE ? ESCAPE '\\' OR ${resourceMatch('a.resources_json')})`,filterArgs=[a.query,query,query,query,query,query,query];
 const select=`SELECT a.id,a.name,a.type,a.status,a.person_role,a.member_status,a.member_work_paused,a.closed,a.deleted,a.version,a.current_need,a.resources_json,a.updated_at,
  ${stageSince} stage_since,
  (SELECT count(*) FROM work_tasks t WHERE t.archive_id=a.id AND t.status='open') open_tasks,
  (SELECT count(*) FROM work_tasks t WHERE t.archive_id=a.id AND t.status='open' AND t.owner_id IS NULL) unassigned_tasks,
  (SELECT count(*) FROM work_tasks t WHERE t.archive_id=a.id AND t.status='open' AND t.deadline_at<?) overdue_tasks,
  (SELECT count(*) FROM materials m WHERE m.archive_id=a.id AND m.state='ready' AND m.deleted_at IS NULL) materials,
  (SELECT count(*) FROM observations o WHERE o.archive_id=a.id AND o.deleted=0) observations,
  (SELECT json_group_array(json_object('id',m.id,'name',m.name)) FROM archive_bindings b JOIN members m ON m.id=b.member_id WHERE b.archive_id=a.id AND b.status=a.status) members_json FROM archives a`;
 const rows=await env.DB.prepare(`${select} WHERE ${filter} ORDER BY a.id LIMIT 1001`).bind(new Date(at).toISOString(),...filterArgs).all<Row>();
 const total=await env.DB.prepare(`SELECT count(*) n FROM archives a WHERE ${filter}`).bind(...filterArgs).first<number>('n');
 async function present(page:Row[]):Promise<MapArchive[]>{const resources=await projectResources(env,page.flatMap(r=>JSON.parse(r.resources_json) as ResourceValue[]));let offset=0;return page.map(r=>{const count=(JSON.parse(r.resources_json) as unknown[]).length,values=resources.slice(offset,offset+count);offset+=count;const {resources_json,members_json,updated_at,deleted,member_work_paused,...rest}=r;return {...rest,member_status:effectiveMemberStatus(r.member_status??null,member_work_paused),closed:!!r.closed,resources:values,members:JSON.parse(members_json??'[]'),overdue:archiveReminder({...r,closed:!!r.closed,deleted:!!r.deleted},at)?.overdue??false};});}
 const archives=await present(rows.results.slice(0,1000));
 // History has its own scope: closed/exited people and former resource affiliations
 // remain visible. Never apply today's open/current-assignment filter to past events.
 const history=await env.DB.prepare(`WITH history AS (SELECT e.id,e.archive_id,e.created_at at,e.kind,a.name,
  COALESCE(json_extract(e.before_json,'$.status'),(SELECT json_extract(p.after_json,'$.status') FROM archive_events p WHERE p.archive_id=e.archive_id AND p.seq<e.seq AND json_type(p.after_json,'$.status')='text' ORDER BY p.seq DESC LIMIT 1),'阶段未记录') before,
  COALESCE(json_extract(e.after_json,'$.status'),(SELECT json_extract(p.after_json,'$.status') FROM archive_events p WHERE p.archive_id=e.archive_id AND p.seq<=e.seq AND json_type(p.after_json,'$.status')='text' ORDER BY p.seq DESC LIMIT 1),'阶段未记录') after,
  COALESCE(json_extract(e.before_json,'$.resources'),${snapshot}) before_resources_json,${snapshot} resources_json,
  EXISTS(SELECT 1 FROM archive_events p WHERE p.archive_id=e.archive_id AND p.seq<=e.seq AND json_type(p.after_json,'$.resources')='array' AND p.kind IN('archive.created','archive.profile_changed','archive.resource_transferred')) resources_known,
  json_extract(e.after_json,'$.from_resource_id') from_resource_id,json_extract(e.after_json,'$.to_resource_id') to_resource_id,COALESCE(json_extract(e.after_json,'$.reason'),'') reason,e.seq
 FROM archive_events e JOIN archives a ON a.id=e.archive_id WHERE a.type='person' AND a.deleted=0 AND e.created_at>=?
 AND (e.kind IN('archive.state_changed','archive.closed','archive.reopened','archive.resource_transferred') OR (e.kind='archive.profile_changed' AND json_extract(e.before_json,'$.resources') IS NOT json_extract(e.after_json,'$.resources'))))
 SELECT * FROM history h WHERE (?='' OR h.name LIKE ? ESCAPE '\\' OR ${resourceMatch('h.resources_json')} OR ${resourceMatch('h.before_resources_json')}) ORDER BY seq DESC LIMIT 2001`).bind(cutoff,a.query,query,...Array(10).fill(query)).all<{id:string;archive_id:string;at:string;kind:string;name:string;before:string;after:string;resources_json:string;before_resources_json:string;reason:string;resources_known:number;from_resource_id:string;to_resource_id:string}>();
 const page=history.results.slice(0,2000),values=await projectResources(env,page.flatMap(r=>[...JSON.parse(r.before_resources_json),...JSON.parse(r.resources_json)] as ResourceValue[]));let offset=0;
 const movements:MapMovement[]=page.map(r=>{const beforeCount=JSON.parse(r.before_resources_json).length,count=JSON.parse(r.resources_json).length,before_resources=values.slice(offset,offset+beforeCount),resources=values.slice(offset+beforeCount,offset+beforeCount+count);offset+=beforeCount+count;return {id:r.id,archive_id:r.archive_id,at:r.at,kind:r.kind,before:r.before,after:r.after,before_resources,resources,reason:r.reason,resources_known:!!r.resources_known};});
 const historyIds=[...new Set(page.map(r=>r.archive_id))].filter(id=>!archives.some(a=>a.id===id)),historyRows=historyIds.length?await env.DB.prepare(`${select} WHERE a.deleted=0 AND a.id IN(SELECT value FROM json_each(?))`).bind(new Date(at).toISOString(),JSON.stringify(historyIds)).all<Row>():{results:[]};
 const history_archives=await present(historyRows.results),transfers:MapTransfer[]=movements.flatMap<MapTransfer>((m,i)=>m.kind==='archive.state_changed'?[{archive_id:m.archive_id,at:m.at,before:m.before,after:m.after,resources:m.resources,resources_known:m.resources_known}]:m.kind==='archive.resource_transferred'?[{archive_id:m.archive_id,at:m.at,before:m.before,after:m.after,resources:m.resources,kind:'resource' as const,from_resource_id:page[i].from_resource_id,to_resource_id:page[i].to_resource_id}]:[]);
 const all=await new InternalResources(env,actor,'web').all(),linkedIds=new Set([...archives.flatMap(a=>a.resources),...movements.flatMap(t=>[...t.resources,...t.before_resources])].flatMap(r=>!r.restricted&&r.internal_resource_id?[r.internal_resource_id]:[])),term=a.query.toLowerCase(),inventory=all.filter(r=>!term||linkedIds.has(r.id)||(r.name+' '+r.type).toLowerCase().includes(term));
 return buildPersonnelMap(archives,transfers,{internal_resources:inventory,history_archives,movements,days:a.days,complete:rows.results.length<=1000,history_complete:history.results.length<=2000,total_archives:total??0});
}
