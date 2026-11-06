import {useEffect,useRef,useState} from 'react';

/** Keep only view conditions in the URL; business records and credentials never enter it. */
export function useUrlView<T>(prefix:string,read:(params:URLSearchParams)=>T,write:(params:URLSearchParams,value:T)=>void,enabled=false){
 const current=()=>read(new URLSearchParams(enabled?window.location.search:''));
 const [value,setValue]=useState<T>(current);
 const latest=useRef(value);
 useEffect(()=>{if(!enabled)return;const changed=()=>{const restored=current();latest.current=restored;setValue(restored);};window.addEventListener('popstate',changed);return()=>window.removeEventListener('popstate',changed);},[enabled,prefix]);
 function update(next:T|((old:T)=>T),replace=false){
  const result=typeof next==='function'?(next as (old:T)=>T)(latest.current):next;
  latest.current=result;
  if(enabled){const url=new URL(window.location.href);write(url.searchParams,result);if(url.href!==window.location.href)window.history[replace?'replaceState':'pushState'](window.history.state,'',url.pathname+url.search+url.hash);}
  setValue(result);
 }
 return [value,update] as const;
}
