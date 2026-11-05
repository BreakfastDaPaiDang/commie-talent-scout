import React from 'react';
import {Icon} from './icons';
import './task-observation-entry.css';

export function TaskObservationEntry({open,onOpen,body,onBody,busy,locked,error,onSave}:{open:boolean;onOpen:(open:boolean)=>void;body:string;onBody:(body:string)=>void;busy:boolean;locked:boolean;error:string;onSave:()=>void}){
 return <div className="task-observation-entry">{!open?<button type="button" className="text-button" disabled={busy} onClick={()=>onOpen(true)}><Icon name="plus" size={16}/>记录本次观察</button>:<div className="task-observation-editor"><label>本次观察<textarea rows={4} maxLength={100000} value={body} readOnly={locked} disabled={busy} onChange={e=>onBody(e.target.value)} placeholder="记录本次联系、审核或对接的实际情况"/></label><div className="task-observation-entry-actions"><button type="button" className="button" disabled={busy||!body.trim()} onClick={onSave}>{busy?'正在保存…':locked?'重试保存并引用':'保存到档案并引用'}</button><button type="button" className="text-button" disabled={busy} onClick={()=>onOpen(false)}>收起</button></div>{error&&<p className="form-error" role="alert">{error}</p>}</div>}</div>;
}
