import {archiveStateLabel,isMemberArchive} from '../rules/archive-states.ts';
import type {ResourceEntry,ArchiveResource} from './archive-resources.ts';
export type MapArchive={id:string;name:string;type:'person'|'org';status:string;person_role:'member'|'external'|null;closed:boolean;version:number;resources:ResourceEntry[];current_need:string;stage_since:string;open_tasks:number;unassigned_tasks:number;overdue_tasks:number;overdue:boolean;members:{id:string;name:string}[];materials:number;observations:number};
export type MapTransfer={archive_id:string;before:string;after:string;at:string;resources:ResourceEntry[]};
export type MapCell={id:string;key:string;stage:string;title:string;type:string;archive_id:string|null;people:string[];planned:string[];sources:string[];resources:{source_id:string;entry:ArchiveResource}[];historical:boolean};
export type MapLink={id:string;from:string;to:string;kind:'shared'|'transfer'|'reference';people:string[];sources:string[]};
export type MapLayer={id:string;title:string;people:number;unplaced:number;attention:number;resources:number;materials:number;observations:number;cells:MapCell[]};
export type PersonnelMap={layers:MapLayer[];links:MapLink[];archives:MapArchive[];days:number;complete:boolean;history_complete:boolean;total_archives:number};
export const mapStages=[['视奸观察','观察'],['个人接触','个人接触'],['引荐中（待人事组接触）','引荐与承接'],['人事审核','人事审核'],['已加入待对接','审核通过 · 入社对接'],['已入伙','社员与建设'],['外部社友','外部社友'],['organizations','组织联系与资源']] as const;
export const mapStage=(a:Pick<MapArchive,'type'|'status'|'person_role'>)=>a.type==='org'?'organizations':isMemberArchive(a)?'已入伙':a.status;
const keyOf=(r:ArchiveResource,sourceId:string)=>r.archive_id?'archive:'+r.archive_id:'entry:'+sourceId+':'+r.id;

/** No inferred memberships: active/planned/available remain separate facts. */
export function buildPersonnelMap(archives:MapArchive[],transfers:MapTransfer[],meta:{days:number;complete:boolean;history_complete:boolean;total_archives:number}):PersonnelMap{
 const byId=new Map(archives.map(a=>[a.id,a])),cells=new Map<string,MapCell>(),links=new Map<string,MapLink>();
 function cell(stage:string,key:string,title:string,type:string,archive_id:string|null,historical=false){const id=stage+'|'+key;let c=cells.get(id);if(!c){c={id,key,stage,title,type,archive_id,people:[],planned:[],sources:[],resources:[],historical};cells.set(id,c);}if(!historical)c.historical=false;return c;}
 const unique=(values:string[],id:string)=>{if(!values.includes(id))values.push(id);};
 const unplaced=(stage:string,historical=false)=>cell(stage,'unplaced','归属待补充','人员',null,historical);
 function fromResource(stage:string,r:ArchiveResource,sourceId:string,historical=false){return cell(stage,keyOf(r,sourceId),r.linked_archive?.name??r.name,r.type,r.archive_id,historical);}
 function link(from:MapCell,to:MapCell,kind:MapLink['kind'],personId:string|null,sourceId:string){if(from.id===to.id)return;const endpoints=kind==='shared'?[from.id,to.id].sort():[from.id,to.id],id=kind+'|'+endpoints.join('→');let value=links.get(id);if(!value){value={id,from:endpoints[0],to:endpoints[1],kind,people:[],sources:[]};links.set(id,value);}if(personId)unique(value.people,personId);unique(value.sources,sourceId);}
 for(const a of archives){
  const stage=mapStage(a);let org:MapCell|null=null;
  if(a.type==='org'){org=cell(stage,'archive:'+a.id,a.name,'组织档案',a.id);unique(org.sources,a.id);}
  const actual:MapCell[]=[];
  for(const r of a.resources){if(r.restricted)continue;const c=fromResource(stage,r,a.id);unique(c.sources,a.id);c.resources.push({source_id:a.id,entry:r});
   if(a.type==='person'&&r.usage==='active'){unique(c.people,a.id);actual.push(c);}if(a.type==='person'&&r.usage==='planned')unique(c.planned,a.id);
   if(org&&r.usage==='active')link(org,c,'reference',null,a.id);
  }
  if(a.type==='person'&&!actual.length){const c=unplaced(stage);unique(c.people,a.id);unique(c.sources,a.id);}
  for(let i=0;i<actual.length;i++)for(let j=i+1;j<actual.length;j++)link(actual[i],actual[j],'shared',a.id,a.id);
 }
 for(const t of transfers){const a=byId.get(t.archive_id);if(!a||a.type!=='person'||!mapStages.some(s=>s[0]===t.before)||!mapStages.some(s=>s[0]===t.after)||t.before===t.after)continue;
  const active=t.resources.filter((r):r is ArchiveResource=>!r.restricted&&r.usage==='active');
  if(!active.length)link(unplaced(t.before,true),unplaced(t.after,true),'transfer',a.id,a.id);
  for(const r of active)link(fromResource(t.before,r,a.id,true),fromResource(t.after,r,a.id,true),'transfer',a.id,a.id);
 }
 const layers:MapLayer[]=mapStages.map(([id,title])=>{const people=archives.filter(a=>a.type==='person'&&mapStage(a)===id),layerArchives=archives.filter(a=>mapStage(a)===id),layerCells=[...cells.values()].filter(c=>c.stage===id).sort((a,b)=>Number(a.key==='unplaced')-Number(b.key==='unplaced')||a.title.localeCompare(b.title,'zh-CN'));return {id,title,people:people.length,unplaced:people.filter(p=>!p.resources.some(r=>!r.restricted&&r.usage==='active')).length,attention:people.filter(p=>p.overdue||p.unassigned_tasks||p.overdue_tasks).length,resources:layerCells.filter(c=>c.resources.length>0).length,materials:layerArchives.reduce((n,a)=>n+a.materials,0),observations:layerArchives.reduce((n,a)=>n+a.observations,0),cells:layerCells};});
 return {layers,links:[...links.values()],archives,...meta};
}
