import React,{useState} from 'react';
import {archivePrimaryAction} from '../shared/archive-states';
import {DetailActions} from '../ui/TaskBook';
import {Icon} from '../ui/icons';
import {Modal,ModalActions} from './Modal';
import {api} from './api';
import {PageError} from './ConnectionPages';
import type {Archive} from '../server/archives';

export function ArchiveQuickAction({archive,openTaskCount,onChanged}:{archive:Archive;openTaskCount:number;onChanged:()=>void}){
 const[confirm,setConfirm]=useState(false),action=archivePrimaryAction(archive);
 if(!action)return null;
 return <div className="archive-primary-action"><DetailActions><button className="button primary" onClick={()=>setConfirm(true)}><Icon name="check"/>{action.label}</button></DetailActions>{confirm&&<StateConfirmation key={archive.version} archive={archive} action={action} openTaskCount={openTaskCount} onClose={()=>setConfirm(false)} onChanged={onChanged}/>}</div>;
}
function StateConfirmation({archive,action,openTaskCount,onClose,onChanged}:{archive:Archive;action:NonNullable<ReturnType<typeof archivePrimaryAction>>;openTaskCount:number;onClose:()=>void;onChanged:()=>void}){
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[requestId]=useState(()=>crypto.randomUUID());
 async function submit(){setBusy(true);setError('');try{await api('/archives/state',{id:archive.id,expected_version:archive.version,status:action.status,member_ids:(archive.bindings[action.status]??[]).map(m=>m.id),request_id:requestId});onClose();onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <Modal title={action.label} busy={busy} onClose={onClose}><p>{archive.name}</p><div className="archive-state-change"><span>{archive.status}</span><Icon name="arrow"/><strong>{action.status}</strong></div><p>{action.effect}</p>{openTaskCount>0&&<p className="secondary-copy">现有 {openTaskCount} 项开启任务会保留，需由负责人单独交付。</p>}<PageError error={error} retry={()=>{onClose();onChanged();}} retryLabel="重新读取档案"/><ModalActions><button className="button primary" disabled={busy} onClick={()=>void submit()}>{busy?'正在保存…':action.label}</button></ModalActions></Modal>;
}
