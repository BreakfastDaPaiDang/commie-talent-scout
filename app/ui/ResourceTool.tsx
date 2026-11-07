import React,{useEffect,useState} from 'react';
import type {Resource,ResourceSave} from '../shared/resources';
import {ResourceEditor} from './ResourceEditor';
import './resources.css';

export type ResourceToolProps={load:(search:string)=>Promise<{resources:Resource[]}>;save:(input:ResourceSave)=>Promise<unknown>};
export function ResourceTool({load,save}:ResourceToolProps){
 const [query,setQuery]=useState(''),[resources,setResources]=useState<Resource[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[editing,setEditing]=useState<Resource|true|null>(null);
 useEffect(()=>{let current=true;setLoading(true);setError('');load(query).then(data=>{if(current)setResources(data.resources);}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[load,query,revision]);
 async function saved(input:ResourceSave){const result=await save(input);setRevision(v=>v+1);return result;}
 return <main className="resource-tool"><header><h1>资源工具</h1><button className="button primary" onClick={()=>setEditing(true)}>＋ 新建资源</button></header><input type="search" aria-label="搜索资源" maxLength={100} placeholder="搜索名称、类型或用途" value={query} onChange={e=>setQuery(e.target.value)}/>
  {error&&<p role="alert" className="form-error">{error}<button className="button quiet" onClick={()=>setRevision(v=>v+1)}>重试</button></p>}
  {loading?<p role="status">读取中…</p>:<div className="resource-catalog">{resources.map(r=><button className="resource-row" key={r.id} onClick={()=>setEditing(r)}><strong>{r.name}</strong><span>{[r.kind,...r.purposes].filter(Boolean).join(' · ')}</span>{r.note&&<p>{r.note}</p>}{!r.active&&<small>已停用</small>}</button>)}{!resources.length&&<p className="resource-empty">{query?'没有匹配资源':'暂无资源'}</p>}</div>}
  {editing&&<ResourceEditor value={editing===true?undefined:editing} save={saved} close={()=>setEditing(null)}/>}
 </main>;
}
