import React,{useId,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './icons';
import {Modal,ModalActions} from './Modal';
import './task-observation-entry.css';

export function TaskResultDescription({value,onChange,action}:{value:string;onChange:(value:string)=>void;action:ReactNode}){
 const id=useId();
 return <div className="task-result-description"><div className="task-result-description-head"><label htmlFor={id}>结果说明</label>{action}</div><textarea id={id} required rows={3} maxLength={5000} value={value} onChange={e=>onChange(e.target.value)} placeholder="如实交代做了什么、结果是什么、还需要什么"/></div>;
}

export function TaskObservationEntry({open,onOpen,body,onBody,busy,locked,error,onSave}:{open:boolean;onOpen:(open:boolean)=>void;body:string;onBody:(body:string)=>void;busy:boolean;locked:boolean;error:string;onSave:()=>void}){
 return <><div className="task-observation-entry"><button type="button" className="button quiet" disabled={busy||open} onClick={()=>onOpen(true)}><Icon name="plus" size={15}/>创建观察</button></div>{open&&createPortal(<Modal title="创建观察" busy={busy} onClose={()=>onOpen(false)} feedback={error?<p className="form-error" role="alert">{error}</p>:undefined}><form className="manage-form modal-form task-observation-form" onSubmit={e=>{e.preventDefault();e.stopPropagation();onSave();}}><label>观察正文<textarea required rows={6} maxLength={100000} value={body} readOnly={locked} disabled={busy} onChange={e=>onBody(e.target.value)} placeholder="记录本次联系、审核或对接的实际情况"/></label><ModalActions><button type="submit" className="button primary" disabled={busy||!body.trim()}>{busy?'正在保存…':locked?'重试保存并引用':'保存并用于交付'}</button></ModalActions></form></Modal>,document.body)}</>;
}
