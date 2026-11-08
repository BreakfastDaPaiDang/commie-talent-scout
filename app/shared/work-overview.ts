import type {Resource} from './resources.ts';
export const experienceTypes = [
 {id:'contact',label:'接触',color:'#c84640',tint:'#f2ada4'},
 {id:'review',label:'审核',color:'#d5a119',tint:'#f1d178'},
 {id:'onboarding',label:'对接',color:'#b77a60',tint:'#deb09a'},
 {id:'member',label:'社员',color:'#8c8177',tint:'#f2efeb'},
 {id:'friend',label:'社外联系',color:'#9b687d',tint:'#f6edf1'},
] as const;
export type ExperienceType=typeof experienceTypes[number]['id'];
export const dayMs=86400000;
export function experienceType(status:string):ExperienceType{return status==='人事审核'||status==='引荐中（待人事组接触）'?'review':status==='已加入待对接'?'onboarding':status==='已入伙'?'member':status==='外部社友'||status==='组织交流'?'friend':'contact';}
export function experienceLabel(status:string){return status==='已加入待对接'?'审核通过 · 对接':status==='已入伙'?'社员':status;}
export type OverviewResource=Resource;
export type OverviewGap={id:string;version:number;purpose:ExperienceType;work:string;missing:string;resolved:boolean};
export type OverviewPlacement={id:string;version:number;archive_id:string;event_id:string;resource_ids:string[];note:string;usage:'planned'|'active'};
export type ExperienceEvent={id:string;archive_id:string;seq:number;created_at:string;kind:string;after:{status?:string}|null};
export type OverviewObservation={id:string;archive_id:string;created_at:string;occurred_at?:string|null;content_version?:number;event_id?:string;event_seq?:number;body:string;author_name:string};
export type OverviewTask={id:string;archive_id:string;title:string;owner_id:string|null;owner_name:string|null;owner_frozen:boolean;deadline_at:string;follow_up?:boolean};
export type OverviewArchive={id:string;name:string;type:'person'|'org';status:string;created_at:string;person_role:string|null;version?:number;current_need?:string};
export type WhiteResource={id:string;version:number;archive_id:string;event_id:string;observation_id:string;content_version:number;resource_id:string|null;capacity:number|null;removed:boolean};
export type ExperienceSegment={id:string;status:string;type:ExperienceType|null;source:'state'|'observation';observation_id:string|null;start:string;end:string;days:number;current:boolean;observations:OverviewObservation[];placements:OverviewPlacement[]};
export type OverviewPerson=OverviewArchive&{segments:ExperienceSegment[];last_observation_at:string|null;due_at:string;tasks:OverviewTask[];owner_name:string|null;assignment:'assigned'|'unassigned'|'conflict';history_complete:boolean};
export type WorkOverviewData={as_of:string;people:OverviewPerson[];resources:OverviewResource[];gaps:OverviewGap[];white_resources?:WhiteResource[]};

export function buildExperience(a:OverviewArchive,events:ExperienceEvent[],observations:OverviewObservation[],placements:OverviewPlacement[],asOf:string):ExperienceSegment[]{
 const changes=events.filter(e=>e.archive_id===a.id&&['archive.created','archive.state_changed','archive.reopened'].includes(e.kind)&&e.after?.status&&e.created_at<=asOf).sort((x,y)=>Date.parse(x.created_at)-Date.parse(y.created_at)||x.seq-y.seq);
 const stages:ExperienceEvent[]=[];
 for(const e of changes)if(stages.at(-1)?.after?.status!==e.after!.status)stages.push(e);
 type Boundary={id:string;at:string;seq:number;stage:ExperienceEvent|null;observation:OverviewObservation|null};
 const boundaries:Boundary[]=stages.map(e=>({id:e.id,at:e.created_at,seq:e.seq,stage:e,observation:null}));
 for(const o of observations){
  const at=o.occurred_at??o.created_at,time=Date.parse(at);
  if(o.archive_id!==a.id||o.created_at>asOf||!Number.isFinite(time)||time>Date.parse(asOf))continue;
  const seq=o.occurred_at?Number.MAX_SAFE_INTEGER:o.event_seq??Number.MAX_SAFE_INTEGER;
  const stage=[...stages].reverse().find(e=>Date.parse(e.created_at)<time||(Date.parse(e.created_at)===time&&e.seq<=seq))??null;
  boundaries.push({id:o.event_id??o.id,at,seq,stage,observation:o});
 }
 boundaries.sort((x,y)=>Date.parse(x.at)-Date.parse(y.at)||x.seq-y.seq||(x.observation?.created_at??x.at).localeCompare(y.observation?.created_at??y.at)||x.id.localeCompare(y.id));
 return boundaries.map((b,i)=>{
  const end=boundaries[i+1]?.at??asOf,status=b.stage?.after?.status??'阶段未记录';
  return {id:b.id,status,type:b.stage?experienceType(status):null,source:b.observation?'observation':'state',observation_id:b.observation?.id??null,start:b.at,end,days:Math.max(0,(Date.parse(end)-Date.parse(b.at))/dayMs),current:i===boundaries.length-1,observations:b.observation?[b.observation]:[],placements:placements.filter(p=>p.archive_id===a.id&&p.event_id===b.id)};
 });
}
/** Preserve the elapsed-time row length, reserving a small clickable sliver for same-time records. */
export function experienceWidths(segments:ExperienceSegment[],maxDays:number):number[]{
 if(!segments.length)return [];
 const total=segments.reduce((n,s)=>n+s.days,0),budget=Math.min(87.5,Math.max(total/(maxDays>0?maxDays:1)*87.5,Math.min(segments.length*1.5,12)));
 const floor=Math.min(1.5,budget/segments.length),widths=segments.map(s=>total?s.days/total*budget:budget/segments.length);
 let remaining=budget,weight=total;const pending=new Set(widths.map((_,i)=>i));
 while(pending.size){
  const small=[...pending].filter(i=>weight===0||segments[i].days/weight*remaining<floor);
  if(!small.length){for(const i of pending)widths[i]=segments[i].days/weight*remaining;break;}
  for(const i of small){widths[i]=floor;remaining-=floor;weight-=segments[i].days;pending.delete(i);}
  if(weight<=0){for(const i of pending)widths[i]=remaining/pending.size;break;}
 }
 return widths;
}
export function buildOverviewPerson(a:OverviewArchive,events:ExperienceEvent[],observations:OverviewObservation[],placements:OverviewPlacement[],tasks:OverviewTask[],asOf:string):OverviewPerson{
 const last=observations.filter(o=>o.archive_id===a.id&&o.created_at<=asOf).map(o=>o.created_at).sort().at(-1)??null;
 const work=tasks.filter(t=>t.archive_id===a.id),owners=[...new Set(work.filter(t=>t.follow_up!==false&&t.owner_id&&!t.owner_frozen).map(t=>t.owner_id))];
 const segments=buildExperience(a,events,observations,placements,asOf);
 return {...a,segments,last_observation_at:last,due_at:new Date(Date.parse(last??a.created_at)+30*dayMs).toISOString(),tasks:work,owner_name:owners.length===1?work.find(t=>t.owner_id===owners[0])!.owner_name:null,assignment:owners.length>1?'conflict':owners.length===1?'assigned':'unassigned',history_complete:!!segments.length&&segments.every(s=>s.type!==null)&&segments.at(-1)!.status===a.status};
}
export function backlogForecast(people:OverviewPerson[],asOf:string,days=30){return Array.from({length:days+1},(_,day)=>{const at=Date.parse(asOf)+day*dayMs;const counts=Object.fromEntries(experienceTypes.map(t=>[t.id,0])) as Record<ExperienceType,number>;for(const p of people)if(Date.parse(p.due_at)<=at)counts[experienceType(p.status)]++;return {day,counts,total:Object.values(counts).reduce((a,b)=>a+b,0)};});}
export function resourceDistribution(resources:OverviewResource[],white:WhiteResource[]=[]){
 const groups=new Map<string,{id:string;label:string;color:string;count:number;capacity:number;unknown:number}>();
 const add=(id:string,label:string,color:string,capacity:number|null)=>{const g=groups.get(id)??{id,label,color,count:0,capacity:0,unknown:0};g.count++;g.capacity+=capacity??0;g.unknown+=capacity===null?1:0;groups.set(id,g);};
 for(const r of resources.filter(r=>r.active&&!r.deleted)){
  const types=experienceTypes.filter(t=>r.purposes.includes(t.id));
  const rgb=[0,2,4].map(offset=>Math.round(types.reduce((n,t)=>n+parseInt(t.color.slice(1+offset,3+offset),16),0)/Math.max(types.length,1)).toString(16).padStart(2,'0')).join('');
  add(types.map(t=>t.id).join('+')||'unspecified',types.map(t=>t.label).join('＋')||'用途未登记',types.length?'#'+rgb:'#d5d0c9',r.capacity);
 }
 for(const w of white.filter(w=>!w.removed&&!w.resource_id))add('white','待补齐','#ffffff',w.capacity);
 return [...groups.values()];
}

export function referencedResources(data:WorkOverviewData):OverviewResource[]{
 const stages=new Map<string,Set<ExperienceType>>();
 for(const p of data.people)for(const s of p.segments)for(const placement of s.placements)for(const id of placement.resource_ids){const types=stages.get(id)??new Set<ExperienceType>();if(s.type)types.add(s.type);stages.set(id,types);}
 for(const white of data.white_resources??[])if(!white.removed&&white.resource_id){const types=stages.get(white.resource_id)??new Set<ExperienceType>();types.add('review');stages.set(white.resource_id,types);}
 return data.resources.filter(r=>stages.has(r.id)).map(r=>({...r,purposes:[...stages.get(r.id)!]}));
}
export function overviewResourceDistribution(data:WorkOverviewData){return resourceDistribution(referencedResources(data),data.white_resources);}
