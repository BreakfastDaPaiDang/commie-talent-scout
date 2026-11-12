import React from 'react';
import './whale-home.css';

export const whaleEntrances=[
  {color:'red',label:'外部人物',href:'/people'},
  {color:'yellow',label:'社员',href:'/members'},
  {color:'green',label:'任务',href:'/tasks'},
  {color:'black',label:'仪表盘',href:'/statistics'},
  {color:'purple',label:'知识库',href:'/knowledge'},
  {color:'blue',label:'Agent 接入',href:'/agent'},
] as const;

/** Each entrance is a separate transparent image, link and interaction layer. */
export function WhaleHome({onNavigate}:{onNavigate?:(href:string)=>void}){
  return <main className="whale-home" aria-label="康米巨星主页">
    <h1 className="whale-home-title">康米巨星</h1>
    <nav className="whale-constellation" aria-label="主页入口">
      {whaleEntrances.map(({color,label,href})=><a key={color} href={href}
        className={`whale-entrance whale-entrance--${color}`} aria-label={label}
        onClick={event=>{if(onNavigate&&event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();onNavigate(href);}}}>
        <img src={`/art/whale-home/${color}.webp`} width="1024" height="1024" alt="" draggable="false" decoding="async" fetchPriority={color==='blue'?'high':'auto'}/>
        <span className="whale-entrance-label">{label}<span aria-hidden="true">↗</span></span>
      </a>)}
    </nav>
  </main>;
}
