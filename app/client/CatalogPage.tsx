import React,{useEffect,useState} from 'react';
import {CatalogWorkspace,type CatalogApi} from '../ui/CatalogWorkspace';
import {catalogRead,catalogWrite,catalogUpload} from './catalog-api';
import type {CatalogIdentity} from '../shared/catalog';
const client:CatalogApi={read:catalogRead,write:catalogWrite,upload:catalogUpload,fileUrl:id=>'/api/catalog/files/'+id+'/content',giftUrl:key=>location.origin+'/knowledge#gift='+encodeURIComponent(key)};
export function CatalogPage(){
 const [identity,setIdentity]=useState<CatalogIdentity|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let current=true;setError('');setIdentity(null);void(async()=>{
  const gift=new URLSearchParams(location.hash.slice(1)).get('gift');if(gift){history.replaceState(null,'',location.pathname+location.search);await catalogRead('/access/session',{key:gift});}
  const result=await catalogRead<{identity:CatalogIdentity}>('/identity');if(current)setIdentity(result.identity);
 })().catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[revision]);
 if(error)return <main className="resource-tool"><h1>生产资源库</h1><p role="alert" className="form-error">{error}</p><a className="button" href="/">返回主站登录</a><button className="button quiet" onClick={()=>setRevision(v=>v+1)}>重试</button></main>;
 if(!identity)return <main className="resource-tool"><p role="status">正在打开资源库…</p></main>;
 return <CatalogWorkspace key={identity.kind+identity.id} api={client} identity={identity}/>;
}
