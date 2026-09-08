import React,{createContext,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {IconButton} from './Workspace';
export const ModalAlertTarget=createContext<HTMLElement|null>(null);
export const ModalControls=createContext<{onClose:()=>void;busy:boolean}|null>(null);
// The approved native-dialog implementation, shared with the prototype.
export function Modal({title,children,onClose,wide=false,busy=false,feedback}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean;busy?:boolean;feedback?:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null),titleId=useId(),backdropPress=useRef(false),[alertTarget,setAlertTarget]=useState<HTMLElement|null>(null);
 const outside=(e:React.MouseEvent<HTMLDialogElement>)=>{const r=e.currentTarget.getBoundingClientRect();return e.target===e.currentTarget&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom);};
 useEffect(()=>{const trigger=document.activeElement,dialog=ref.current!;dialog.showModal();dialog.querySelector<HTMLElement>('input:not([type="file"]):not([type="hidden"]), textarea, select')?.focus({preventScroll:true});return()=>{dialog.close();if(trigger instanceof HTMLElement&&trigger.isConnected)trigger.focus({preventScroll:true});};},[]);
 return <dialog ref={ref} aria-labelledby={titleId} aria-label={title} className={`modal ${wide?'wide':''}`} onCancel={e=>{e.preventDefault();e.stopPropagation();if(!busy)onClose();}} onPointerDown={e=>{backdropPress.current=outside(e);}} onClick={e=>{if(!busy&&backdropPress.current&&outside(e))onClose();backdropPress.current=false;}}><div className="modal-chrome"><header className="modal-head"><h2 id={titleId}>{title}</h2><IconButton name="close" label="关闭对话框" disabled={busy} onClick={onClose}/></header>{feedback}<div ref={setAlertTarget}/></div><ModalControls.Provider value={{onClose,busy}}><ModalAlertTarget.Provider value={alertTarget}>{children}</ModalAlertTarget.Provider></ModalControls.Provider></dialog>;
}
