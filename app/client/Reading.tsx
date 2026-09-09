import React,{createContext,useContext,useEffect,useRef,useState,type RefObject} from 'react';
import {api,ApiError} from './api';
import type {ArchiveReadDelivery,ArchiveReadConfirmation} from '../server/archive-reading';
import type {ReadDelivery} from '../server/reading';

export const ArchiveReadingScope=createContext(false);
export function ArchiveRead({delivery,container}:{delivery:ArchiveReadDelivery;container:RefObject<HTMLElement|null>}){
 const[error,setError]=useState('');
 useEffect(()=>{
  let cancelled=false,busy=false,done=false,retryAt=0;
  const confirm=()=>{
   if(cancelled||busy||done||Date.now()<retryAt||document.visibilityState!=='visible'||document.querySelector('dialog[open],[role="dialog"]')||!container.current?.getClientRects().length)return;
   busy=true;void api<ArchiveReadConfirmation>('/reading/archive',{ticket:delivery.ticket}).then(result=>{
    done=true;window.dispatchEvent(new CustomEvent('cts-archive-reading-confirmed',{detail:result}));window.dispatchEvent(new CustomEvent('cts-reading-confirmed',{detail:[]}));if(!cancelled)setError('');
   }).catch(e=>{if(cancelled)return;if(e instanceof ApiError&&e.status<500&&e.status!==429){done=true;setError(e.message);}else{setError('阅读进度暂未保存，正在重试');retryAt=Date.now()+5000;}}).finally(()=>{busy=false;});
  };
  confirm();const timer=setInterval(confirm,250);document.addEventListener('visibilitychange',confirm);
  return()=>{cancelled=true;clearInterval(timer);document.removeEventListener('visibilitychange',confirm);};
 },[delivery.ticket,container]);
 return error?<small className="reading-retry" role="status">{error}</small>:null;
}

// Observe only the start of the rendered content, not the full (possibly very long) card.
// Receipts remain unconfirmed while hidden, covered by a dialog, outside the viewport,
// or waiting for an image-only observation to finish loading.
export function ReadBoundary({reading,imageOnly=false}:{reading?:ReadDelivery|null;imageOnly?:boolean}){
 const archiveOpening=useContext(ArchiveReadingScope);
 const ref=useRef<HTMLSpanElement>(null),[error,setError]=useState('');
 useEffect(()=>{
  const element=ref.current;if(!element||!reading||archiveOpening)return;
  let intersecting=false,started=0,retryAt=0,busy=false,done=false,cancelled=false;
  const observer=new IntersectionObserver(entries=>{intersecting=entries[0].intersectionRatio>=0.8;if(!intersecting)started=0;},{threshold:[0,0.8,1]});observer.observe(element);
  const timer=setInterval(()=>{
   const eligible=intersecting&&document.visibilityState==='visible'&&!document.querySelector('dialog[open],[role="dialog"]')&&element.getClientRects().length>0&&(!imageOnly||Array.from(element.closest('article')?.querySelectorAll('.image-gallery img')??[]).slice(0,1).some(img=>img instanceof HTMLImageElement&&img.complete&&img.naturalWidth>0));
   if(!eligible){started=0;return;}if(done||busy||Date.now()<retryAt)return;
   if(!started){started=Date.now();return;}if(Date.now()-started<500)return;
   busy=true;void api<{confirmed:ReadDelivery[];unconfirmed:string[]}>('/reading/confirm',{tickets:[reading.ticket]}).then(result=>{
    if(result.confirmed.length)window.dispatchEvent(new CustomEvent('cts-reading-confirmed',{detail:result.confirmed.map(r=>r.event_id)}));if(cancelled)return;done=true;setError(result.unconfirmed.length?'内容已变化，正在重新读取':'');if(result.unconfirmed.length)window.dispatchEvent(new CustomEvent('cts-reading-stale'));
   }).catch(()=>{if(!cancelled){setError('阅读进度暂未保存，正在重试');retryAt=Date.now()+5000;}}).finally(()=>{busy=false;});
  },250);
  return()=>{cancelled=true;clearInterval(timer);observer.disconnect();};
 },[reading?.ticket,imageOnly,archiveOpening]);
 return <><span ref={ref} className="reading-boundary" aria-hidden="true"/>{error&&<small className="reading-retry" role="status">{error}</small>}</>;
}
export function Highlight({text,query}:{text:string;query?:string}){
 if(!query)return <>{text}</>;const parts:React.ReactNode[]=[],lower=text.toLocaleLowerCase(),needle=query.toLocaleLowerCase();let start=0,index=lower.indexOf(needle);
 while(index>=0){parts.push(text.slice(start,index),<mark key={index}>{text.slice(index,index+query.length)}</mark>);start=index+query.length;index=lower.indexOf(needle,start);}parts.push(text.slice(start));return <>{parts}</>;
}
