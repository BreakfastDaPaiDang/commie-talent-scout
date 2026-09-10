import React,{useLayoutEffect,useRef,useState,type ReactNode} from 'react';

// User-selected artwork. A detail mount draws once; edits and refreshes keep it.
const ornaments=['12-collective-forward','15-common-record','25-steps-on-map','28-pages-to-flag','30-connected-line','35-star-eye-imprint'] as const;

export function AvatarOrnament({children}:{children:ReactNode}){
 const shell=useRef<HTMLDivElement>(null);
 const [ornament]=useState(()=>ornaments[Math.floor(Math.random()*ornaments.length)]);
 useLayoutEffect(()=>{
  const element=shell.current,header=element?.closest<HTMLElement>('.entity-header');
  if(!element||!header||typeof ResizeObserver==='undefined')return;
  const fit=()=>{const bounds=header.getBoundingClientRect(),avatar=element.getBoundingClientRect();element.style.setProperty('--ornament-height',`${Math.min(210,bounds.height+16)}px`);element.style.setProperty('--ornament-top',`${bounds.top-avatar.top-16}px`);};
  const observer=new ResizeObserver(fit);observer.observe(header);observer.observe(element);fit();return()=>observer.disconnect();
 },[]);
 return <div ref={shell} className="entity-avatar avatar-hero"><span className="avatar-ornament" aria-hidden="true" data-ornament={ornament} style={{backgroundImage:`url("/art/avatar-ornaments/${ornament}.png")`}}/>{children}</div>;
}
