import React,{useLayoutEffect,useRef,useState,type ReactNode} from 'react';

// User-selected artwork. A detail mount draws once; edits and refreshes keep it.
// Centers refer to the intended avatar position in each full source PNG,
// not the PNG midpoint or its opaque-pixel bounds.
const ornaments=[
 {id:'12-collective-forward',aspect:1.5,x:.50,y:.45},
 {id:'15-common-record',aspect:2,x:.54,y:.35},
 {id:'25-steps-on-map',aspect:1.5,x:.50,y:.48},
 {id:'28-pages-to-flag',aspect:2,x:.55,y:.56},
 {id:'30-connected-line',aspect:1.5,x:.50,y:.48},
 {id:'35-star-eye-imprint',aspect:2,x:.66,y:.40},
] as const;

export function AvatarOrnament({children}:{children:ReactNode}){
 const shell=useRef<HTMLDivElement>(null);
 const [ornament]=useState(()=>ornaments[Math.floor(Math.random()*ornaments.length)]);
 useLayoutEffect(()=>{
  const element=shell.current,header=element?.closest<HTMLElement>('.entity-header');
  if(!element||!header||typeof ResizeObserver==='undefined')return;
  const heading=header.querySelector<HTMLElement>('.entity-heading'),actions=header.querySelector<HTMLElement>('.archive-edit-entry');
  const fit=()=>{
   const bounds=header.getBoundingClientRect(),avatar=element.getBoundingClientRect();
   const left=(heading?.getBoundingClientRect().right??bounds.left)+12,right=(actions?.getBoundingClientRect().left??bounds.right)-12,top=bounds.top-20,bottom=bounds.bottom;
   const width=Math.max(0,Math.min(340,210*ornament.aspect,right-left,(bottom-top)*ornament.aspect)),height=width/ornament.aspect;
   const shown=innerWidth>=1100&&bounds.width>=760&&width>=220&&avatar.width>0;
   element.dataset.ornamentFits=String(shown);
   const centerX=avatar.left+avatar.width/2,centerY=avatar.top+avatar.height/2;
   const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
   // Move the whole composition only as far as its available space requires.
   element.style.setProperty('--composition-x',`${shown?clamp(centerX,left+width*ornament.x,right-width*(1-ornament.x))-centerX:0}px`);
   element.style.setProperty('--composition-y',`${shown?clamp(centerY,top+height*ornament.y,bottom-height*(1-ornament.y))-centerY:0}px`);
   element.style.setProperty('--avatar-scale',String(shown?width/Math.min(340,210*ornament.aspect):1));
   element.style.setProperty('--ornament-width',`${width}px`);element.style.setProperty('--ornament-height',`${height}px`);
   element.style.setProperty('--ornament-left',`${-width*ornament.x}px`);element.style.setProperty('--ornament-top',`${-height*ornament.y}px`);
  };
  const observer=new ResizeObserver(fit);for(const node of [header,element,heading,actions])if(node)observer.observe(node);fit();return()=>observer.disconnect();
 },[ornament]);
 return <div ref={shell} className="entity-avatar avatar-hero"><span className="avatar-composition"><span className="avatar-ornament" aria-hidden="true" data-ornament={ornament.id} style={{backgroundImage:`url("/art/avatar-ornaments/${ornament.id}.png")`}}/>{children}</span></div>;
}
