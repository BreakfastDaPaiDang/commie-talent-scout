import React,{useState} from 'react';
import {Modal} from './Modal';
import './share-link.css';

export function ShareLink({path,label='分享'}:{path:string;label?:string}){
 const [copied,setCopied]=useState(false),[fallback,setFallback]=useState('');
 async function copy(){const url=new URL(path,location.origin).href;try{await navigator.clipboard.writeText(url);setCopied(true);}catch{setFallback(url);}}
 return <><button type="button" aria-label={label} className="button quiet share-link" onClick={()=>void copy()}>{copied?'链接已复制':'分享'}</button>{fallback&&<Modal title="分享链接" onClose={()=>setFallback('')}><div className="share-link-fallback"><label>复制此链接<input autoFocus readOnly value={fallback} onFocus={e=>e.currentTarget.select()}/></label></div></Modal>}</>;
}
