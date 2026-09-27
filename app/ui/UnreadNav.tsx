import React,{type ReactNode} from 'react';
import {Icon} from './icons';
import './unread-nav.css';

export function UnreadNav({active,onClick,children}:{active:boolean;onClick:()=>void;children?:ReactNode}){
 return <button type="button" className="icon-button unread-nav" aria-label="未读更新" title="未读更新" aria-current={active?'page':undefined} onClick={onClick}><Icon name="bell"/>{children}</button>;
}
