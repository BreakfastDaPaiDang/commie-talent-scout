import React,{useEffect,useRef,useState,type ReactNode} from 'react';
import './scroll-region.css';

/** A bounded list with a visible indication that more rows exist below it. */
export function ScrollRegion({children,className,label,rows,sticky,report=false}:{children:ReactNode;className:string;label:string;rows:string;sticky?:string;report?:boolean}){
 const root=useRef<HTMLDivElement>(null);
 const [range,setRange]=useState({first:0,last:0,total:0,overflow:false,more:false});
 useEffect(()=>{
  const el=root.current;if(!el||report)return;
  let frame=0;
  const measure=()=>{
   const rect=el.getBoundingClientRect(),top=rect.top+(sticky?el.querySelector(sticky)?.getBoundingClientRect().height??0:0);
   const items=[...el.querySelectorAll(rows)],visible=items.map((item,i)=>({i,rect:item.getBoundingClientRect()})).filter(item=>item.rect.bottom>top+1&&item.rect.top<rect.bottom-1);
   const next={first:visible.length?visible[0].i+1:0,last:visible.length?visible.at(-1)!.i+1:0,total:items.length,overflow:el.clientHeight>0&&el.scrollHeight>el.clientHeight+1,more:el.scrollTop+el.clientHeight<el.scrollHeight-1};
   setRange(old=>Object.keys(next).every(key=>old[key as keyof typeof old]===next[key as keyof typeof next])?old:next);
  };
  const update=()=>{window.cancelAnimationFrame(frame);frame=window.requestAnimationFrame(measure);};
  const observer=typeof window.ResizeObserver==='function'?new window.ResizeObserver(update):null;observer?.observe(el);if(el.firstElementChild)observer?.observe(el.firstElementChild);
  el.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);measure();
  return()=>{window.cancelAnimationFrame(frame);observer?.disconnect();el.removeEventListener('scroll',update);window.removeEventListener('resize',update);};
 },[children,rows,sticky,report]);
 return <><div ref={root} className={`${className} scroll-region`} tabIndex={report?undefined:0} aria-label={label}>{children}</div>{!report&&range.overflow&&<div className="scroll-region-hint"><span>显示 {range.first}–{range.last} / 共 {range.total} 条</span>{range.more?<button type="button" onClick={()=>{const el=root.current;if(el)el.scrollBy({top:Math.max(1,el.clientHeight*.75),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}} aria-label={`向下查看${label}`}>向下查看 ↓</button>:<span>已到底</span>}</div>}</>;
}
