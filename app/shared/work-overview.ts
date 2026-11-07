export const experienceTypes = [
 {id:'contact',label:'接触',color:'#d45149',tint:'#fff0ee'},
 {id:'review',label:'审核',color:'#c99a22',tint:'#fff7db'},
 {id:'onboarding',label:'对接',color:'#b77a60',tint:'#f9eee8'},
 {id:'member',label:'社员',color:'#8c8177',tint:'#f2efeb'},
 {id:'friend',label:'社外联系',color:'#9b687d',tint:'#f6edf1'},
] as const;
export type ExperienceType=typeof experienceTypes[number]['id'];
export const dayMs=86400000;
export function experienceType(status:string):ExperienceType{return status==='人事审核'||status==='引荐中（待人事组接触）'?'review':status==='已加入待对接'?'onboarding':status==='已入伙'?'member':status==='外部社友'||status==='组织交流'?'friend':'contact';}
export function experienceLabel(status:string){return status==='已加入待对接'?'审核通过 · 对接':status==='已入伙'?'社员':status;}
export type OverviewResource={id:string;version:number;name:string;kind:string;purposes:ExperienceType[];capacity:number|null;active:boolean;deleted?:boolean;note:string};
export type OverviewGap={id:string;version:number;purpose:ExperienceType;work:string;missing:string;resolved:boolean};
export type OverviewPlacement={id:string;version:number;archive_id:string;event_id:string;resource_ids:string[];note:string;usage:'planned'|'active'};
export type ExperienceEvent={id:string;archive_id:string;seq:number;created_at:string;kind:string;after:{status?:string}|null};
export type OverviewObservation={id:string;archive_id:string;created_at:string;body:string;author_name:string};
export type OverviewTask={id:string;archive_id:string;title:string;owner_id:string|null;owner_name:string|null;owner_frozen:boolean;deadline_at:string};
export type OverviewArchive={id:string;name:string;type:'person'|'org';status:string;created_at:string;person_role:string|null};
export type ExperienceSegment={id:string;status:string;type:ExperienceType;start:string;end:string;days:number;current:boolean;observations:OverviewObservation[];placements:OverviewPlacement[]};
export type OverviewPerson=OverviewArchive&{segments:ExperienceSegment[];last_observation_at:string|null;due_at:string;tasks:OverviewTask[];owner_name:string|null;assignment:'assigned'|'unassigned'|'conflict';history_complete:boolean};
export type WorkOverviewData={as_of:string;people:OverviewPerson[];resources:OverviewResource[];gaps:OverviewGap[]};

export function buildExperience(a:OverviewArchive,events:ExperienceEvent[],observations:OverviewObservation[],placements:OverviewPlacement[],asOf:string):ExperienceSegment[]{
 const changes=events.filter(e=>e.archive_id===a.id&&['archive.created','archive.state_changed','archive.reopened'].includes(e.kind)&&e.after?.status&&e.created_at<=asOf).sort((x,y)=>Date.parse(x.created_at)-Date.parse(y.created_at)||x.seq-y.seq);
 const starts:ExperienceEvent[]=[];
 for(const e of changes)if(starts.at(-1)?.after?.status!==e.after!.status)starts.push(e);
 return starts.map((e,i)=>{const start=e.created_at,end=starts[i+1]?.created_at??asOf;return {id:e.id,status:e.after!.status!,type:experienceType(e.after!.status!),start,end,days:Math.max(0,(Date.parse(end)-Date.parse(start))/dayMs),current:i===starts.length-1,observations:observations.filter(o=>o.archive_id===a.id&&o.created_at>=start&&(i===starts.length-1?o.created_at<=end:o.created_at<end)),placements:placements.filter(p=>p.archive_id===a.id&&p.event_id===e.id)};});
}
export function buildOverviewPerson(a:OverviewArchive,events:ExperienceEvent[],observations:OverviewObservation[],placements:OverviewPlacement[],tasks:OverviewTask[],asOf:string):OverviewPerson{
 const last=observations.filter(o=>o.archive_id===a.id&&o.created_at<=asOf).map(o=>o.created_at).sort().at(-1)??null;
 const work=tasks.filter(t=>t.archive_id===a.id),owners=[...new Set(work.filter(t=>t.owner_id&&!t.owner_frozen).map(t=>t.owner_id))];
 const segments=buildExperience(a,events,observations,placements,asOf);
 return {...a,segments,last_observation_at:last,due_at:new Date(Date.parse(last??a.created_at)+30*dayMs).toISOString(),tasks:work,owner_name:owners.length===1?work.find(t=>t.owner_id===owners[0])!.owner_name:null,assignment:owners.length>1?'conflict':owners.length===1?'assigned':'unassigned',history_complete:!!segments.length&&segments.at(-1)!.status===a.status};
}
export function backlogForecast(people:OverviewPerson[],asOf:string,days=30){return Array.from({length:days+1},(_,day)=>{const at=Date.parse(asOf)+day*dayMs;const counts=Object.fromEntries(experienceTypes.map(t=>[t.id,0])) as Record<ExperienceType,number>;for(const p of people)if(Date.parse(p.due_at)<=at)counts[experienceType(p.status)]++;return {day,counts,total:Object.values(counts).reduce((a,b)=>a+b,0)};});}
export function resourceDistribution(resources:OverviewResource[]){return experienceTypes.map(t=>{const items=resources.filter(r=>r.active&&!r.deleted&&r.purposes.includes(t.id));return {...t,count:items.length,capacity:items.reduce((n,r)=>n+(r.capacity??0),0),unknown:items.filter(r=>r.capacity===null).length};});}
