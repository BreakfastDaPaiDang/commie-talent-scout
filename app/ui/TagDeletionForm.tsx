import React,{type FormEvent,type ReactNode} from 'react';
import {ModalActions} from './Modal';

export function TagDeletionForm({deleted,reason,onReason,busy,preview,onInspect,onBack,onSave,error}:{deleted:boolean;reason:string;onReason:(v:string)=>void;busy:boolean;preview:{notice:string;child_tags:number;counts:{open:number;closed:number}}|null;onInspect:(e?:FormEvent)=>void;onBack:()=>void;onSave:()=>void;error:ReactNode}){
 const verb=deleted?'恢复':'删除';
 return preview?<div className="definition-impact"><p>{preview.notice}</p>{preview.child_tags>0&&<p>类别下有 {preview.child_tags} 个未单独删除的词条。</p>}<p>保留 {preview.counts.open} 个开启档案、{preview.counts.closed} 个关闭档案的已有引用。</p>{error}<ModalActions><button className="button" disabled={busy} onClick={onBack}>返回修改</button><button className={'button '+(deleted?'primary':'danger-text')} disabled={busy} onClick={onSave}>{busy?'正在保存…':'确认'+verb}</button></ModalActions></div>:<form className="manage-form" onSubmit={onInspect}><label>{verb}原因<textarea required rows={3} maxLength={300} value={reason} onChange={e=>onReason(e.target.value)}/></label>{error}<ModalActions><button className="button primary" disabled={busy}>{busy?'正在核对影响…':'查看'+verb+'影响'}</button></ModalActions></form>;
}
