import React,{useSyncExternalStore} from 'react';
import {Icon} from './icons';
import './themes.css';

type Theme='light'|'night';
const key='cts-display-mode';
const valid=(value:string|null|undefined):Theme=>value==='night'?'night':'light';
const snapshot=()=>typeof document==='undefined'?'light':valid(document.documentElement.dataset.theme);
function apply(value:Theme){
 document.documentElement.dataset.theme=value;
 document.documentElement.style.colorScheme=value==='night'?'dark':'light';
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',value==='night'?'#151719':'#202020');
 window.dispatchEvent(new Event('cts-theme-change'));
}
function subscribe(notify:()=>void){
 const storage=(event:StorageEvent)=>{if(event.key===key||event.key===null)apply(valid(event.newValue));};
 window.addEventListener('cts-theme-change',notify);window.addEventListener('storage',storage);
 return()=>{window.removeEventListener('cts-theme-change',notify);window.removeEventListener('storage',storage);};
}
export function ThemePicker(){
 const theme=useSyncExternalStore(subscribe,snapshot,()=> 'light');
 const label=theme==='night'?'切换到日间模式':'切换到深夜模式';
 return <button type="button" className="theme-picker" title={label} aria-label={label} onClick={()=>{const value=theme==='night'?'light':'night';apply(value);try{localStorage.setItem(key,value);}catch{/* Switching still works when storage is unavailable. */}}}><Icon name={theme==='night'?'sun':'moon'} size={20}/></button>;
}
