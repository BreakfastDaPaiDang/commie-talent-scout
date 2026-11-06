import {useUrlView} from '../ui/use-url-view';
import {readPersonnelQuery,writePersonnelQuery} from '../shared/personnel-view';
import {ResourceTransfer,type ResourceTransferInput} from '../ui/ResourceTransfer';
import {InternalResourceEditor} from '../ui/InternalResources';
import {internalResourceAdapter} from './internal-resource-adapter';
import type {InternalResource} from '../shared/internal-resources';
import React,{useEffect,useRef,useState} from 'react';
import {api,type Member} from './api';
import {PersonnelMap} from '../ui/PersonnelMap';
import type {PersonnelMap as Data} from '../shared/personnel-map';
import type {Archive} from '../server/archives';
import {archivePath} from '../rules/archive-states';
import {ArchiveForm} from './ArchivesPage';
import {Modal} from './Modal';
const searchTransferResources=(query:string,offset=0)=>internalResourceAdapter.list(query,'active',offset);
export function PersonnelMapPage({actor,onNavigate}:{actor:Member;onNavigate:(path:string)=>void}){
 const [view,setView]=useUrlView('p_query',readPersonnelQuery,writePersonnelQuery,true),{query,days}=view,setQuery=(query:string)=>setView(old=>({...old,query}),true),setDays=(days:number)=>setView(old=>({...old,days}));
 const [transfer,setTransfer]=useState<Archive|null>(null);
 const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[editor,setEditor]=useState<Archive|null>(null),[busy,setBusy]=useState(false),[editError,setEditError]=useState(''),[resourceEditor,setResourceEditor]=useState<InternalResource|null>(null);
 const sequence=useRef(0),editSequence=useRef(0);
 async function load(){const id=++sequence.current;setLoading(true);setError('');try{const result=await api<Data>('/personnel-map?'+new URLSearchParams({query,days:String(days)}));if(id===sequence.current)setData(result);}catch(e){if(id===sequence.current)setError((e as Error).message);}finally{if(id===sequence.current)setLoading(false);}}
 useEffect(()=>{const timer=setTimeout(()=>void load(),query?250:0);return()=>{clearTimeout(timer);sequence.current++;};},[query,days]);
 useEffect(()=>()=>{editSequence.current++;},[]);
 async function edit(id:string){const seq=++editSequence.current;setError('');setNotice('正在读取档案…');try{const result=await api<{archive:Archive}>('/archives/'+id);if(seq!==editSequence.current)return;if(result.archive.closed||result.archive.deleted)throw new Error('档案已关闭或删除，请先核对当前情况');setEditError('');setEditor(result.archive);setNotice('');}catch(e){if(seq===editSequence.current){setNotice('');setError((e as Error).message);}}}
 async function editResource(id:string){const seq=++editSequence.current;setError('');try{const r=await internalResourceAdapter.get(id);if(seq===editSequence.current)setResourceEditor(r);}catch(e){if(seq===editSequence.current)setError((e as Error).message);}}
 async function startTransfer(id:string){const seq=++editSequence.current;setError('');try{const r=await api<{archive:Archive}>('/archives/'+id);if(r.archive.closed||r.archive.deleted)throw new Error('档案当前只读，请核对后再登记');if(seq===editSequence.current)setTransfer(r.archive);}catch(e){if(seq===editSequence.current)setError((e as Error).message);}}
 function open(id:string){const a=[...(data?.archives??[]),...(data?.history_archives??[])].find(a=>a.id===id),linked=data?.archives.flatMap(a=>a.resources).find(r=>!r.restricted&&r.archive_id===id);if(a)onNavigate(archivePath(a)+'?archive='+id);else if(linked&&!linked.restricted&&linked.linked_archive)onNavigate(archivePath(linked.linked_archive)+'?archive='+id);}
 return <>{error&&<p className="form-error pm-error" role="alert">{error} <button className="text-button" onClick={()=>void load()}>重新读取</button></p>}{notice&&<p className="form-notice pm-error" role="status">{notice}</p>}{data?<PersonnelMap urlState onTransfer={id=>void startTransfer(id)} data={data} loading={loading} query={query} onQuery={setQuery} onDays={setDays} onRefresh={()=>void load()} onOpen={open} onEdit={id=>void edit(id)} onResources={()=>onNavigate('/statistics/flow?'+new URLSearchParams({...Object.fromEntries(new URLSearchParams(location.search)),view:'resources'}))} onEditResource={id=>void editResource(id)}/>:!error&&<main className="account-content" role="status">正在读取人员流向…</main>}
  {transfer&&data&&<ResourceTransfer search={searchTransferResources} person={transfer} resources={data.internal_resources} onClose={()=>{editSequence.current++;setTransfer(null);}} onSaved={()=>{setTransfer(null);setNotice('实际调动已登记');void load();}} save={(input:ResourceTransferInput)=>api('/archives/resource-transfer',input)} receipt={id=>api('/commands/'+id)}/>}
  {resourceEditor&&<InternalResourceEditor initial={resourceEditor} adapter={internalResourceAdapter} onClose={()=>{editSequence.current++;setResourceEditor(null);}} onSaved={()=>{setResourceEditor(null);void load();}}/>}
  {editor&&<Modal title="编辑资源与资料" wide busy={busy} onClose={()=>{editSequence.current++;setEditor(null);}} feedback={editError&&<p className="form-error" role="alert">{editError}</p>}><ArchiveForm key={editor.id+editor.version} type={editor.type} initial={editor} busy={busy} setBusy={setBusy} onReload={async()=>{try{const r=await api<{archive:Archive}>('/archives/'+editor.id);setEditor(r.archive);setEditError('');}catch(e){setEditError((e as Error).message);}}} onSaved={async()=>{setEditor(null);setNotice('资源与资料已保存');await load();}}/></Modal>}
 </>;
}
