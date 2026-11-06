import React,{useMemo,useState} from 'react';
import {PersonnelMap} from '../../../app/ui/PersonnelMap';
import {ArchiveResourceFields} from '../../../app/ui/ArchiveResources';
import {Modal,ModalActions} from '../../../app/ui/Modal';
import {buildPersonnelMap,type MapArchive} from '../../../app/shared/personnel-map';
import type {ResourceEntry} from '../../../app/shared/archive-resources';
const id=(n:number)=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const org=(n:number,name:string):MapArchive=>({id:id(n),name,type:'org',status:'组织交流',person_role:null,closed:false,version:1,resources:[],current_need:'',stage_since:new Date(Date.now()-4*86400000).toISOString(),open_tasks:0,unassigned_tasks:0,overdue_tasks:0,overdue:false,members:[],materials:2,observations:3});
const groups=[org(1,'示例学习社群'),org(2,'示例协作项目'),org(3,'示例交流组织')];
const resource=(n:number,target:number,usage:'active'|'planned'|'available'='active'):ResourceEntry=>({id:id(n+100),name:groups[target].name,type:target===1?'项目':'群聊',note:'原型示例资源',archive_id:groups[target].id,usage,linked_archive:groups[target]});
const initial:MapArchive[]=[...groups,...['视奸观察','个人接触','人事审核','已加入待对接','已入伙','外部社友'].flatMap((status,i)=>[0,1].map(j=>({...org(10+i*2+j,`示例人员 ${i*2+j+1}`),type:'person' as const,status,person_role:status==='已入伙'?'member' as const:'external' as const,resources:j?[resource(10+i*2,0),resource(11+i*2,1,'planned')]:[],unassigned_tasks:status==='人事审核'?1:0,current_need:j?'需要明确下一步协作安排':''})))];
export default function PersonnelMapPreview(){
 const [archives,setArchives]=useState(initial),[query,setQuery]=useState(''),[days,setDays]=useState(30),[editing,setEditing]=useState<string|null>(null),[values,setValues]=useState<ResourceEntry[]>([]);
 const data=useMemo(()=>buildPersonnelMap(archives.filter(a=>a.name.includes(query)),[],{days,complete:true,history_complete:true,total_archives:archives.filter(a=>a.name.includes(query)).length}),[archives,query,days]);
 return <><PersonnelMap data={data} query={query} onQuery={setQuery} onDays={setDays} onRefresh={()=>{}} onOpen={id=>{setEditing(id);setValues(archives.find(a=>a.id===id)?.resources??[]);}} onEdit={id=>{setEditing(id);setValues(archives.find(a=>a.id===id)?.resources??[]);}}/>{editing&&<Modal title="编辑资源与资料" wide onClose={()=>setEditing(null)}><form className="modal-form manage-form archive-form" onSubmit={e=>{e.preventDefault();setArchives(old=>old.map(a=>a.id===editing?{...a,resources:values}:a));setEditing(null);}}><ArchiveResourceFields values={values} onChange={setValues} search={async(type,query)=>({archives:archives.filter(a=>a.type===type&&a.name.includes(query)),next_cursor:null})}/><ModalActions><button className="button primary">保存资料</button></ModalActions></form></Modal>}</>;
}
