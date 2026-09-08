import {StateChoices} from '../ui/ArchiveFields';
import {ModalActions} from './Modal';
import {MemberPicker as DirectoryPicker} from '../ui/MemberPicker';
import {Avatar} from './Avatar';
import {avatarUrl} from './AvatarEditor';
import React,{useEffect,useRef,useState,type FormEvent} from 'react';
import {api} from './api';
import {PageError} from './ConnectionPages';
import type {Archive,BoundMember} from '../server/archives';
import {statesFor,isClosedState,isWorkState,memberLabel} from '../shared/archive-states';

export function MemberPicker({value,onChange,label}:{value:BoundMember[];onChange:(items:BoundMember[])=>void;label:string}){
 const[items,setItems]=useState<BoundMember[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 useEffect(()=>{let cancelled=false;setLoading(true);setError('');void(async()=>{let before:string|null=null,all:BoundMember[]=[];do{const r:{members:BoundMember[];next_cursor:string|null}=await api('/members?'+new URLSearchParams({limit:'100',...(before?{before}:{})}));all.push(...r.members);before=r.next_cursor;}while(before&&!cancelled);if(!cancelled)setItems(all);})().catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[retry]);
 const available=[...items,...value.filter(m=>!items.some(other=>other.id===m.id))];
 return <div className="form-field"><label>{label}</label><DirectoryPicker label={label} members={available} value={value.map(m=>m.id)} onChange={ids=>onChange(ids.map(id=>available.find(m=>m.id===id)!))} disabled={loading||!!error} renderAvatar={m=><Avatar name={m.name} src={avatarUrl('member',m.id,0)} size="tiny"/>}/>{loading&&<p role="status">正在读取成员…</p>}<PageError error={error} retry={()=>setRetry(n=>n+1)}/></div>;
}
export function StateFields({type,status,onStatus,members,onMembers,reopen=false}:{type:'person'|'org';status:string;onStatus:(s:string)=>void;members:BoundMember[];onMembers:(m:BoundMember[])=>void;reopen?:boolean}){
 return <section className="archive-state-fields"><StateChoices value={status} onChange={onStatus} choices={statesFor(type).filter(s=>!reopen||!isClosedState(s))}/><MemberPicker label={memberLabel(type,status)+(isWorkState(type,status)?' · 至少一人':' · 可选')} value={members} onChange={onMembers}/>{isWorkState(type,status)&&members.length===0&&<p className="responsible-hint">请明确选择至少一名负责成员。</p>}{isClosedState(status)&&<p className="archive-readonly">保存后会关闭档案，基础资料与观察内容将变为只读。</p>}</section>;
}
export function ArchiveStateForm({archive,busy,setBusy,onSaved,onReload}:{archive:Archive;busy:boolean;setBusy:(b:boolean)=>void;onSaved:(id:string,changed:boolean,message?:string)=>Promise<void>;onReload:()=>Promise<void>}){
 const initialStatus=archive.closed?archive.last_open_status??'视奸观察':archive.status;
 const[status,setStatus]=useState(initialStatus),[members,setMembers]=useState(archive.bindings[initialStatus]??[]),[error,setError]=useState(''),[requestId]=useState(()=>crypto.randomUUID());
 function choose(s:string){setStatus(s);setMembers(isClosedState(s)?archive.members:archive.bindings[s]??[]);}
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await api<{id:string;changed:boolean;definition_changes?:{before:{category_name:string;name:string;description:string};after:{category_name:string;name:string;description:string;enabled:number;category_enabled:number;merged_into:string|null}}[]}>(archive.closed?'/archives/reopen':'/archives/state',{id:archive.id,expected_version:archive.version,status,member_ids:members.map(m=>m.id),request_id:requestId});await onSaved(r.id,r.changed,r.definition_changes?.length?'已重新开启。标签采用当前定义：'+r.definition_changes.map(d=>`${d.before.category_name}：${d.before.name}（${d.before.description}）→ ${d.after.category_name}：${d.after.name}（${d.after.description}）${!d.after.enabled||!d.after.category_enabled?'；已停用，保留原绑定':''}${d.after.merged_into?'；已有合并去向，未自动迁移':''}`).join('；'):undefined);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <form className="manage-form" onSubmit={submit}><StateFields type={archive.type} status={status} onStatus={choose} members={members} onMembers={setMembers} reopen={archive.closed}/><PageError error={error} retry={()=>void onReload().catch(e=>setError(e.message))} retryLabel="重新读取并替换表单"/><ModalActions><button className={'button primary '+(isClosedState(status)?'close-archive-button':'')} disabled={busy||(isWorkState(archive.type,status)&&members.length===0)}>{busy?'正在保存…':archive.closed?'重新开启档案':isClosedState(status)?'保存并关闭档案':'保存状态与成员'}</button></ModalActions></form>;
}
