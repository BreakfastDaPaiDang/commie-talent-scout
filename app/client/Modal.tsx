import React,{useContext,type ComponentProps,type ReactNode} from 'react';
import {Modal as Dialog,ModalControls} from '../ui/Modal';
export function Modal({children,...props}:ComponentProps<typeof Dialog>){return <Dialog {...props}><div className="live-modal-body">{children}</div></Dialog>;}

export function ModalActions({children}:{children:ReactNode}){const controls=useContext(ModalControls);return <div className="modal-actions">{controls&&<button type="button" className="button quiet" disabled={controls.busy} onClick={controls.onClose}>取消</button>}{children}</div>;}
