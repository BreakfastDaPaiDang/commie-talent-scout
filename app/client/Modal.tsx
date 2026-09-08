import React,{useEffect,useRef,type ReactNode} from 'react';
export function Modal({title,onClose,busy=false,children}:{title:string;onClose:()=>void;busy?:boolean;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current!;dialog.showModal();return()=>dialog.close();},[]);
  return <dialog ref={ref} className="form-dialog" aria-label={title} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><div className="dialog-heading"><h2>{title}</h2><button className="icon-close" aria-label="关闭" disabled={busy} onClick={onClose}>×</button></div>{children}</dialog>;
}
