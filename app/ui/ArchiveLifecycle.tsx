import React from 'react';
import {Icon} from './icons';

export function ArchiveLifecycleNotice({deleted,closed,onRestore,onReopen,onDelete}:{deleted:boolean;closed:boolean;onRestore?:()=>void;onReopen?:()=>void;onDelete?:()=>void}){
 if(!deleted&&!closed)return null;
 return <div className="locked-notice"><Icon name="lock"/><span>{deleted?'档案已删除，恢复后可继续使用。':'只读档案，重新开启后可继续维护。'}</span>{deleted?onRestore&&<button className="text-button" onClick={onRestore}>恢复档案</button>:<>{onReopen&&<button className="text-button" onClick={onReopen}>重新开启</button>}{onDelete&&<button className="text-button" onClick={onDelete}>删除档案</button>}</>}</div>;
}

export function ArchiveDeletionConfirmation({name,status,deleted,busy,error,onConfirm,onCancel,onReload}:{name:string;status:string;deleted:boolean;busy:boolean;error?:string;onConfirm:()=>void;onCancel:()=>void;onReload?:()=>void}){
 return <div className="manage-form archive-deletion-confirmation"><p><strong>{name}</strong></p><p>{deleted?`恢复后将回到档案列表，业务状态仍为“${status}”。`:'整张档案将移至“已删除档案”，观察记录、图片和历史仍会保留，管理员可以恢复。'}</p>{error&&<p className="form-error" role="alert">{error}</p>}{error&&onReload&&<button className="button quiet" disabled={busy} onClick={onReload}>重新读取档案状态</button>}<div className="modal-actions"><button className="button quiet" disabled={busy} onClick={onCancel}>取消</button><button className={'button '+(deleted?'primary':'danger')} disabled={busy} onClick={onConfirm}>{busy?'正在处理…':deleted?'确认恢复档案':'确认删除档案'}</button></div></div>;
}
