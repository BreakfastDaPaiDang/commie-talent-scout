import React,{useRef,useState,type ReactNode} from 'react';
import {Modal,ModalActions} from './Modal';
import {resourcePurposes,type Resource,type ResourceSave} from '../shared/resources';
import './resources.css';

export function ResourceEditor({value,save,close,title,entityLabel='资源',submitLabel='保存',capacityLabel='可接收人数',extraFields,hideDelete=false,blocked=false}:{value?:Resource;save:(input:ResourceSave)=>Promise<unknown>;close:()=>void;title?:string;entityLabel?:string;submitLabel?:string;capacityLabel?:string;extraFields?:ReactNode;hideDelete?:boolean;blocked?:boolean}){
 const id=useRef(value?.id??crypto.randomUUID());
 const [name,setName]=useState(value?.name??''),[kind,setKind]=useState(value?.kind??''),[purposes,setPurposes]=useState(resourcePurposes(value?.purposes??[]).join('、'));
 const [note,setNote]=useState(value?.note??''),[capacity,setCapacity]=useState(value?.capacity?.toString()??''),[active,setActive]=useState(value?.active??true);
 const [busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[error,setError]=useState(''),[confirmDelete,setConfirmDelete]=useState(false);
 async function submit(remove=false){if(busy||blocked)return;setBusy(true);setError('');try{
  await save(remove?{entity:'resource_delete',id:id.current,expected_version:value!.version}:{entity:'resource',id:id.current,expected_version:value?.version??0,name,kind,purposes:purposes.split(/[、,，;；\n]/).map(s=>s.trim()).filter(Boolean),note,capacity:capacity===''?null:Number(capacity),active});close();
 }catch(e){setError((e as Error).message);setLocked(!!(e as {retryOnly?:boolean}).retryOnly);}finally{setBusy(false);}}
 return <Modal title={title??(value?'编辑资源':'新建资源')} onClose={close} busy={busy||blocked}><form className="resource-editor" onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={busy||locked}>
  <label>{entityLabel}名称<input autoFocus required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
  <div className="resource-fields"><label>资源类型<input maxLength={60} value={kind} onChange={e=>setKind(e.target.value)} placeholder="可选"/></label><label>用途<input maxLength={2430} value={purposes} onChange={e=>setPurposes(e.target.value)} placeholder="自由填写，多个用途用顿号分隔"/></label></div>
  <label>说明<textarea aria-label="说明" rows={4} maxLength={3000} value={note} onChange={e=>setNote(e.target.value)}/></label>
  {extraFields}
  <div className="resource-fields"><label>{capacityLabel}<input type="number" min="0" max="100000" step="1" value={capacity} onChange={e=>setCapacity(e.target.value)} placeholder="可选"/></label><label className="resource-check"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>开放使用</label></div>
 </fieldset>{error&&<p role="alert" className="form-error">{error}</p>}{value&&!hideDelete&&<div className="resource-delete">{confirmDelete?<><p>删除“{value.name}”？已有使用记录保留。</p><button type="button" className="button danger" disabled={busy} onClick={()=>void submit(true)}>确认删除资源</button><button type="button" className="button quiet" disabled={busy||locked} onClick={()=>setConfirmDelete(false)}>取消</button></>:<button type="button" className="text-button" disabled={busy||locked} onClick={()=>setConfirmDelete(true)}>删除资源</button>}</div>}<ModalActions><button className="button primary" disabled={busy||blocked||confirmDelete}>{busy?'提交中…':locked?'重试提交':submitLabel}</button></ModalActions></form></Modal>;
}
