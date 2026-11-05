import React,{useEffect,useRef,useState} from 'react';
import type {ArchiveResource,ResourceEntry,ResourceReference} from '../shared/archive-resources';
import {resourceUsages} from '../shared/archive-resources';
import {archivePath,archiveStateLabel} from '../rules/archive-states';
import './archive-resources.css';

export type ResourceArchiveSearch=(type:'person'|'org',query:string,before?:string)=>Promise<{archives:ResourceReference[];next_cursor:string|null}>;
export function ArchiveResourceFields({values,onChange,search,disabled=false}:{values:ResourceEntry[];onChange:(values:ResourceEntry[])=>void;search?:ResourceArchiveSearch;disabled?:boolean}){
 return <fieldset className="archive-resource-field" disabled={disabled}><legend>资源</legend>
  {values.map((resource,i)=>resource.restricted?<div className="resource-hidden" key={resource.id}><span>关联资源暂不可见</span><button type="button" className="icon-close" aria-label={`移除资源${i+1}`} onClick={()=>onChange(values.filter((_,n)=>n!==i))}>×</button></div>:<ResourceEditor key={resource.id} index={i} value={resource} search={search} onChange={next=>onChange(values.map((r,n)=>n===i?next:r))} onRemove={()=>onChange(values.filter((_,n)=>n!==i))}/>)}
  <button type="button" className="button quiet" disabled={values.length>=30} onClick={()=>onChange([...values,{id:crypto.randomUUID(),name:'',type:'群聊',note:'',archive_id:null,usage:'available'}])}>＋ 添加资源</button>
 </fieldset>;
}
function ResourceEditor({value,onChange,onRemove,index,search}:{value:ArchiveResource;onChange:(v:ArchiveResource)=>void;onRemove:()=>void;index:number;search?:ResourceArchiveSearch}){
 const [expanded,setExpanded]=useState(!value.name),[choosing,setChoosing]=useState(false),[kind,setKind]=useState<'person'|'org'>('org'),[query,setQuery]=useState(''),[items,setItems]=useState<ResourceReference[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const sequence=useRef(0),label=`资源${index+1}`;
 async function load(before?:string){if(!search)return;const seq=++sequence.current;setBusy(true);setError('');try{const result=await search(kind,query,before);if(seq!==sequence.current)return;setItems(old=>before?[...old,...result.archives]:result.archives);setCursor(result.next_cursor);}catch(e){if(seq===sequence.current)setError((e as Error).message);}finally{if(seq===sequence.current)setBusy(false);}}
 useEffect(()=>{if(!choosing)return;setItems([]);setCursor(null);const timer=setTimeout(()=>void load(),200);return()=>{clearTimeout(timer);sequence.current++;};},[choosing,query,kind]);
 return <section className="resource-editor" aria-label={label}><div className="resource-editor-head"><button type="button" className="resource-expand" aria-expanded={expanded} onClick={()=>setExpanded(v=>!value.name.trim()||!value.type.trim()?true:!v)}>{expanded?'▾':'▸'} {value.name||'新资源'}<small>{value.type} · {resourceUsages[value.usage]}</small></button><button type="button" className="icon-close" aria-label={`移除${label}`} onClick={onRemove}>×</button></div>
  <div hidden={!expanded} className="resource-editor-body"><div className="resource-editor-grid"><label>名称<input aria-label={`${label}名称`} value={value.name} required maxLength={120} onChange={e=>onChange({...value,name:e.target.value})}/></label><label>类型<input aria-label={`${label}类型`} value={value.type} required maxLength={60} placeholder="群聊、工作组、项目等" onChange={e=>onChange({...value,type:e.target.value})}/></label></div>
   <label>使用情况<select aria-label={`${label}使用情况`} value={value.usage} onChange={e=>onChange({...value,usage:e.target.value as ArchiveResource['usage']})}>{Object.entries(resourceUsages).map(([key,title])=><option key={key} value={key}>{title}</option>)}</select></label>
   <label>说明<textarea aria-label={`${label}说明`} rows={2} maxLength={3000} value={value.note} onChange={e=>onChange({...value,note:e.target.value})} placeholder="用途、联系方法或实际使用情况"/></label>
   {value.archive_id?<div className="resource-linked"><span>关联档案：{value.linked_archive?.name??'已关联档案'}</span><button type="button" className="text-button" onClick={()=>onChange({...value,archive_id:null,linked_archive:null})}>解除关联</button></div>:search&&<button type="button" className="text-button" aria-expanded={choosing} onClick={()=>setChoosing(v=>!v)}>{choosing?'收起档案选择':'关联已有档案'}</button>}
   {choosing&&!value.archive_id&&<div className="resource-archive-picker"><div className="resource-picker-query"><label><span className="visually-hidden">档案类型</span><select aria-label={`${label}关联档案类型`} value={kind} onChange={e=>setKind(e.target.value as 'person'|'org')}><option value="org">组织</option><option value="person">人物／社员</option></select></label><label><span className="visually-hidden">搜索档案</span><input aria-label={`${label}搜索档案`} placeholder="搜索现有档案" value={query} maxLength={120} onChange={e=>setQuery(e.target.value)}/></label></div>
    {items.map(item=><button type="button" className="resource-archive-option" key={item.id} onClick={()=>{onChange({...value,archive_id:item.id,linked_archive:item});setChoosing(false);}}><span>{item.name}</span><small>{archiveStateLabel(item.status)}</small></button>)}
    {busy&&<p role="status">正在读取档案…</p>}{!busy&&!items.length&&!error&&<p>没有匹配的档案</p>}{error&&<p role="alert">{error}<button type="button" className="text-button" onClick={()=>void load()}>重试</button></p>}{cursor&&<button type="button" className="text-button" disabled={busy} onClick={()=>void load(cursor)}>加载更多档案</button>}
   </div>}
  </div>
 </section>;
}
export function ArchiveResourceList({values}:{values:ResourceEntry[]}){
 if(!values.length)return null;
 return <section className="archive-resource-summary" aria-label="资源"><h2>资源</h2><ul>{values.map(r=><li key={r.id}>{r.restricted?<span className="muted">关联资源暂不可见</span>:<><div><strong>{r.linked_archive?.name??r.name}</strong><span className="resource-type">{r.type}</span><span className={'resource-usage '+r.usage}>{resourceUsages[r.usage]}</span></div>{r.note&&<p>{r.note}</p>}{r.linked_archive&&<a href={`${archivePath(r.linked_archive)}?archive=${r.linked_archive.id}`}>查看关联档案 ↗</a>}</>}</li>)}</ul></section>;
}
