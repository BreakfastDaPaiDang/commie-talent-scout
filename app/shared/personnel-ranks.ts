import {isMemberArchive} from '../rules/archive-states.ts';
import type {MapArchive,MapCell,MapLayer,MapLink,PersonnelMap} from './personnel-map.ts';

export const personnelRanks=[
 {id:'pending',title:'待审核',states:['视奸观察','个人接触','引荐中（待人事组接触）']},
 {id:'review',title:'审核中',states:['人事审核']},
 {id:'approved',title:'审核通过',states:['已加入待对接']},
 {id:'member',title:'社员',states:['已入伙']},
 {id:'friend',title:'社外社友',states:['外部社友']},
] as const;
export type MapOrganization={id:string;name:string;status:string;version:number;current_need:string;members:{id:string;name:string}[];materials:number;observations:number};
export const rankForStatus=(status:string)=>personnelRanks.find(r=>(r.states as readonly string[]).includes(status))?.id??null;
export const rankForPerson=(a:Pick<MapArchive,'type'|'status'|'person_role'>)=>a.type==='person'?(isMemberArchive(a)?'member':rankForStatus(a.status)):null;
export function rankCellId(id:string|null){if(!id)return id;const i=id.indexOf('|'),rank=rankForStatus(id.slice(0,i));return rank?rank+id.slice(i):id;}
export const isFlowLink=(e:MapLink)=>e.kind==='transfer'||e.kind==='resource_transfer';

/** A view of identity/review facts, never a write or a forced onboarding sequence. */
export function rankPersonnelMap(data:PersonnelMap):PersonnelMap{
 const cells=new Map<string,MapCell>(),ids=new Map<string,string>(),edges=new Map<string,MapLink>();
 const merge=(a:string[],b:string[])=>[...new Set([...a,...b])];
 for(const layer of data.layers){const rank=personnelRanks.some(r=>r.id===layer.id)?layer.id:rankForStatus(layer.id);if(!rank)continue;
  for(const old of layer.cells){const id=rank+'|'+old.key;ids.set(old.id,id);const previous=cells.get(id);
   if(!previous){const title=old.key==='unplaced'?({pending:'待审核人员',review:'审核待承接',approved:'待入社对接',member:'社员待安排',friend:'社外社友'}[rank]??old.title):old.title;cells.set(id,{...old,id,stage:rank,title,people:[...old.people],planned:[...old.planned],sources:[...old.sources],resources:[...old.resources]});}
   else{previous.people=merge(previous.people,old.people);previous.planned=merge(previous.planned,old.planned);previous.sources=merge(previous.sources,old.sources);previous.historical=previous.historical&&old.historical;previous.resources=[...new Map([...previous.resources,...old.resources].map(r=>[r.source_id+'|'+r.entry.id,r])).values()];}
  }
 }
 for(const c of cells.values())c.planned=c.planned.filter(id=>!c.people.includes(id));
 for(const e of data.links){let from=ids.get(e.from),to=ids.get(e.to);if(!from||!to||from===to)continue;if(e.kind==='shared')[from,to]=[from,to].sort();const id=e.kind+'|'+from+'→'+to,old=edges.get(id);if(old){old.people=merge(old.people,e.people);old.sources=merge(old.sources,e.sources);}else edges.set(id,{...e,id,from,to,people:[...e.people],sources:[...e.sources]});}
 const orgs=data.organizations??[],orgIds=new Set(orgs.map(o=>o.id));
 if(orgs.length){const id='friend|external-organizations';cells.set(id,{id,key:'external-organizations',stage:'friend',title:'社外组织',type:'组织关系',archive_id:null,people:[],planned:[],sources:[],resources:[],historical:false,resource_id:null,organization_ids:orgs.map(o=>o.id)});
  // A person's recorded contact to an external organization is a relationship,
  // never a personnel transfer or proof of an internally owned resource.
  for(const c of cells.values()){if(c.id===id||!c.archive_id||!orgIds.has(c.archive_id))continue;const people=merge(c.people,c.planned);if(people.length)edges.set('organization_contact|'+c.id,{id:'organization_contact|'+c.id,from:c.id,to:id,kind:'organization_contact',people,sources:[c.archive_id]});}
 }
 const layers:MapLayer[]=personnelRanks.map(rank=>{
  const oldLayers=data.layers.filter(l=>(rankForStatus(l.id)??l.id)===rank.id),current=data.archives.filter(a=>rankForPerson(a)===rank.id),items=[...cells.values()].filter(c=>c.stage===rank.id).sort((a,b)=>Number(!!a.organization_ids)-Number(!!b.organization_ids)||(b.people.length+b.planned.length)-(a.people.length+a.planned.length)||a.title.localeCompare(b.title,'zh-CN'));
  return {id:rank.id,title:rank.title,people:current.length,unplaced:oldLayers.reduce((n,l)=>n+l.unplaced,0),attention:oldLayers.reduce((n,l)=>n+l.attention,0),resources:new Set(items.filter(c=>c.resource_id&&data.internal_resources.find(r=>r.id===c.resource_id)?.status!=='archived').map(c=>c.resource_id)).size,materials:current.reduce((n,a)=>n+a.materials,0),observations:current.reduce((n,a)=>n+a.observations,0),organizations:rank.id==='friend'?orgs.length:0,cells:items};
 });
 return {...data,layers,links:[...edges.values()],group_by:'rank'};
}
