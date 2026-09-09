import React,{type ComponentProps} from 'react';
import {Modal as Dialog} from '../ui/Modal';
export function Modal({children,...props}:ComponentProps<typeof Dialog>){return <Dialog {...props}><div className="live-modal-body">{children}</div></Dialog>;}

export {ModalActions} from '../ui/Modal';
