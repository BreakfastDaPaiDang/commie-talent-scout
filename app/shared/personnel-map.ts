import type {MapOrganization} from './personnel-ranks.ts';
import {reception,personnelAttention} from './personnel-signals.ts';
import type {InternalResource} from './internal-resources.ts';
import {isMemberArchive} from '../rules/archive-states.ts';
import type {ResourceEntry,ArchiveResource} from './archive-resources.ts';
export type MapArchive={id:string;name:string;type:'person'|'org';status:string;person_role:'member'|'external'|null;member_status?:'可接工作'|'暂不接工作'|'请假'|'失联'|null;closed:boolean;version:number;resources:ResourceEntry[];current_need:string;stage_since:string;open_tasks:number;unassigned_tasks:number;overdue_tasks:number;overdue:boolean;members:{id:string;name:string}[];materials:number;observations:number};
export type MapTransfer={archive_id:string;before:string;after:string;at:string;resources:ResourceEntry[];resources_known?:boolean;kind?:'stage'|'resource';from_resource_id?:string;to_resource_id?:string};
export type MapMovement={id:string;archive_id:string;at:string;kind:string;before:string;after:string;resources:ResourceEntry[];before_resources:ResourceEntry[];reason:string;resources_known?:boolean};
export type MapCell={id:string;key:string;stage:string;title:string;type:string;archive_id:string|null;people:string[];planned:string[];sources:string[];resources:{source_id:string;entry:ArchiveResource}[];historical:boolean;resource_id:string|null;organization_ids?:string[]};
export type MapLink={id:string;from:string;to:string;kind:'shared'|'transfer'|'resource_transfer'|'organization_contact';people:string[];sources:string[]};
export type MapLayer={id:string;title:string;people:number;unplaced:number;attention:number;resources:number;materials:number;observations:number;organizations?:number;cells:MapCell[]};
export type PersonnelMap={layers:MapLayer[];links:MapLink[];archives:MapArchive[];days:number;complete:boolean;history_complete:boolean;total_archives:number;internal_resources:InternalResource[];history_archives?:MapArchive[];movements?:MapMovement[];organizations?:MapOrganization[];organization_total?:number;organizations_complete?:boolean;group_by?:'status'|'rank'};
export const mapStages=[['视奸观察','观察'],['个人接触','个人接触'],['引荐中（待人事组接触）','引荐与承接'],['人事审核','人事审核'],['已加入待对接','审核通过 · 入社对接'],['已入伙','社员与建设'],['外部社友','外部社友'],['已弃用','关闭与退出（历史）']] as const;
export const mapStage=(a:Pick<MapArchive,'type'|'status'|'person_role'>)=>a.type==='org'?'organizations':isMemberArchive(a)?'已入伙':a.status;


/** No inferred memberships: active/planned/available remain separate facts. */
export function buildPersonnelMap(archives:MapArchive[],transfers:MapTransfer[],meta:{days:number;complete:boolean;history_complete:boolean;total_archives:number;internal_resources?:InternalResource[];history_archives?:MapArchive[];movements?:MapMovement[]}):PersonnelMap{
 const inventory=meta.internal_resources??[],resourceById=new Map(inventory.map(r=>[r.id,r]));archives=archives.filter(a=>a.type==='person');
 const byId=new Map([...archives,...(meta.history_archives??[])].map(a=>[a.id,a])),cells=new Map<string,MapCell>(),links=new Map<string,MapLink>();
 function cell(stage:string,key:string,title:string,type:string,archive_id:string|null,historical=false){const id=stage+'|'+key;let c=cells.get(id);if(!c){c={id,key,stage,title,type,archive_id,people:[],planned:[],sources:[],resources:[],historical,resource_id:key.startsWith('internal:')?key.slice(9):null};cells.set(id,c);}if(!historical)c.historical=false;return c;}
 const unique=(values:string[],id:string)=>{if(!values.includes(id))values.push(id);};
 const unplaced=(stage:string,historical=false)=>cell(stage,'unplaced','未落实社内承接','人员',null,historical);
 function internalCell(stage:string,r:InternalResource,historical=false){return cell(stage,'internal:'+r.id,r.name,r.type,null,historical);}
 function fromResource(stage:string,r:ArchiveResource,sourceId:string,historical=false){const internal=r.internal_resource_id?resourceById.get(r.internal_resource_id):null;if(internal)return internalCell(stage,internal,historical);return cell(stage,r.archive_id?'contact:'+r.archive_id:'contact:'+sourceId+':'+r.id,r.linked_archive?.name??r.name,'原有关联容器',r.archive_id,historical);}
 for(const r of inventory)if(r.status!=='archived')for(const stage of r.stage_ids)if(mapStages.some(s=>s[0]===stage))internalCell(stage,r);
 function link(from:MapCell,to:MapCell,kind:MapLink['kind'],personId:string|null,sourceId:string){if(from.id===to.id)return;const endpoints=kind==='shared'?[from.id,to.id].sort():[from.id,to.id],id=kind+'|'+endpoints.join('→');let value=links.get(id);if(!value){value={id,from:endpoints[0],to:endpoints[1],kind,people:[],sources:[]};links.set(id,value);}if(personId)unique(value.people,personId);unique(value.sources,sourceId);}
 for(const a of archives){
  const stage=mapStage(a);
  const actual:MapCell[]=[];
  for(const r of a.resources){if(r.restricted||r.internal_resource_id&&!resourceById.has(r.internal_resource_id))continue;const c=fromResource(stage,r,a.id);unique(c.sources,a.id);c.resources.push({source_id:a.id,entry:r});
   if(a.type==='person'&&r.usage==='active'){unique(c.people,a.id);actual.push(c);}if(a.type==='person'&&r.usage==='planned'&&!a.resources.some(v=>!v.restricted&&!!r.internal_resource_id&&v.internal_resource_id===r.internal_resource_id&&v.usage==='active'))unique(c.planned,a.id);

  }
  if(a.type==='person'&&reception(a)!=='placed'){const c=unplaced(stage);unique(c.people,a.id);unique(c.sources,a.id);}
  for(let i=0;i<actual.length;i++)for(let j=i+1;j<actual.length;j++)link(actual[i],actual[j],'shared',a.id,a.id);
 }
 for(const t of transfers){const a=byId.get(t.archive_id);if(!a||a.type!=='person'||!mapStages.some(s=>s[0]===t.before))continue;
  if(t.kind==='resource'){
   const from=inventory.find(r=>r.id===t.from_resource_id),to=inventory.find(r=>r.id===t.to_resource_id);
   if(from&&to)link(internalCell(t.before,from,true),internalCell(t.after,to,true),'resource_transfer',a.id,a.id);
   continue;
  }
  if(!mapStages.some(s=>s[0]===t.after)||t.before===t.after)continue;
  if(t.resources_known===false){link(cell(t.before,'history-unknown','当时资源未记录','历史',null,true),cell(t.after,'history-unknown','当时资源未记录','历史',null,true),'transfer',a.id,a.id);continue;}
  const active=t.resources.filter((r):r is ArchiveResource=>!r.restricted&&(!r.internal_resource_id||resourceById.has(r.internal_resource_id))&&r.usage==='active');
  if(!active.length)link(unplaced(t.before,true),unplaced(t.after,true),'transfer',a.id,a.id);
  for(const r of active)link(fromResource(t.before,r,a.id,true),fromResource(t.after,r,a.id,true),'transfer',a.id,a.id);
 }
 const layers:MapLayer[]=mapStages.map(([id,title])=>{const people=archives.filter(a=>a.type==='person'&&mapStage(a)===id),layerArchives=archives.filter(a=>mapStage(a)===id),layerCells=[...cells.values()].filter(c=>c.stage===id).sort((a,b)=>Number(a.key==='unplaced')-Number(b.key==='unplaced')||a.title.localeCompare(b.title,'zh-CN'));return {id,title,people:people.length,unplaced:people.filter(p=>reception(p)!=='placed').length,attention:people.filter(p=>personnelAttention(p,Date.now(),inventory).length>0).length,resources:layerCells.filter(c=>c.resource_id&&resourceById.get(c.resource_id)?.status!=='archived').length,materials:layerArchives.reduce((n,a)=>n+a.materials,0),observations:layerArchives.reduce((n,a)=>n+a.observations,0),cells:layerCells};});
 return {layers,links:[...links.values()],archives,...meta,internal_resources:inventory};
}
