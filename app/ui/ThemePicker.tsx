import React,{useSyncExternalStore} from 'react';
import './themes.css';

type Theme='light'|'night'|'care';
const key='cts-display-mode';
const valid=(value:string|null|undefined):Theme=>value==='night'||value==='care'?value:'light';
const snapshot=()=>typeof document==='undefined'?'light':valid(document.documentElement.dataset.theme);
function apply(value:Theme){
 document.documentElement.dataset.theme=value;
 document.documentElement.style.colorScheme=value==='night'?'dark':'light';
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',value==='night'?'#151719':value==='care'?'#eee6d5':'#202020');
 window.dispatchEvent(new Event('cts-theme-change'));
}
function subscribe(notify:()=>void){
 const storage=(event:StorageEvent)=>{if(event.key===key||event.key===null)apply(valid(event.newValue));};
 window.addEventListener('cts-theme-change',notify);window.addEventListener('storage',storage);
 return()=>{window.removeEventListener('cts-theme-change',notify);window.removeEventListener('storage',storage);};
}
export function ThemePicker(){
 const theme=useSyncExternalStore(subscribe,snapshot,()=> 'light');
 return <label className="theme-picker" title="显示模式"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/></svg><select aria-label="显示模式" value={theme} onChange={e=>{const value=valid(e.target.value);apply(value);try{localStorage.setItem(key,value);}catch{/* The selected mode still works when storage is unavailable. */}}}><option value="light">日间</option><option value="night">深夜</option><option value="care">护眼</option></select></label>;
}
