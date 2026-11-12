import React,{useEffect,useState} from 'react';
import {api} from './api';
import {mutate} from './mutations';
import {ResourceTool} from '../ui/ResourceTool';
import {CatalogPage} from './CatalogPage';
import type {Resource,ResourceSave} from '../shared/resources';
const load=(search:string)=>api<{resources:Resource[]}>('/resources?'+new URLSearchParams({search}));
const save=(input:ResourceSave)=>mutate('/resources/save',input);
export function ResourcePage(){
 const [mode,setMode]=useState<string|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;setError('');api<{mode:string}>('/resources/authority').then(r=>{if(active)setMode(r.mode);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[revision]);
 if(error)return <main className="resource-tool"><p className="form-error" role="alert">{error}</p><button className="button" onClick={()=>setRevision(v=>v+1)}>重试</button></main>;
 if(mode===null)return <main className="resource-tool"><p role="status">正在打开资源工具…</p></main>;
 return mode==='independent'?<CatalogPage/>:<ResourceTool load={load} save={save}/>;
}
