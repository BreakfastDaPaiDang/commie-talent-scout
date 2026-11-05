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
export function PersonnelMapPage({actor,onNavigate}:{actor:Member;onNavigate:(path:string)=>void}){
 const [data,setData]=useState<Data|null>(null),[query,setQuery]=useState(''),[days,setDays]=useState(30),[loading,setLoading]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[editor,setEditor]=useState<Archive|null>(null),[busy,setBusy]=useState(false),[editError,setEditError]=useState(''),[resourceEditor,setResourceEditor]=useState<InternalResource|null>(null);
 const sequence=useRef(0),editSequence=useRef(0);
 async function load(){const id=++sequence.current;setLoading(true);setError('');try{const result=await api<Data>('/personnel-map?'+new URLSearchParams({query,days:String(days)}));if(id===sequence.current)setData(result);}catch(e){if(id===sequence.current)setError((e as Error).message);}finally{if(id===sequence.current)setLoading(false);}}
 useEffect(()=>{const timer=setTimeout(()=>void load(),query?250:0);return()=>{clearTimeout(timer);sequence.current++;};},[query,days]);
 useEffect(()=>()=>{editSequence.current++;},[]);
 async function edit(id:string){const seq=++editSequence.current;setError('');setNotice('正在读取档案…');try{const result=await api<{archive:Archive}>('/archives/'+id);if(seq!==editSequence.current)return;if(result.archive.closed||result.archive.deleted)throw new Error('档案已关闭或删除，请先核对当前情况');setEditError('');setEditor(result.archive);setNotice('');}catch(e){if(seq===editSequence.current){setNotice('');setError((e as Error).message);}}}
 async function editResource(id:string){const seq=++editSequence.current;setError('');try{const r=await internalResourceAdapter.get(id);if(seq===editSequence.current)setResourceEditor(r);}catch(e){if(seq===editSequence.current)setError((e as Error).message);}}
 function open(id:string){const a=data?.archives.find(a=>a.id===id),linked=data?.archives.flatMap(a=>a.resources).find(r=>!r.restricted&&r.archive_id===id);if(a)onNavigate(archivePath(a)+'?archive='+id);else if(linked&&!linked.restricted&&linked.linked_archive)onNavigate(archivePath(linked.linked_archive)+'?archive='+id);}
 return <>{error&&<p className="form-error pm-error" role="alert">{error} <button className="text-button" onClick={()=>void load()}>重新读取</button></p>}{notice&&<p className="form-notice pm-error" role="status">{notice}</p>}{data?<PersonnelMap data={data} loading={loading} query={query} onQuery={setQuery} onDays={setDays} onRefresh={()=>void load()} onOpen={open} onEdit={id=>void edit(id)} onResources={()=>onNavigate('/statistics/flow?view=resources')} onEditResource={id=>void editResource(id)}/>:!error&&<main className="account-content" role="status">正在读取人员流向…</main>}
  {resourceEditor&&<InternalResourceEditor initial={resourceEditor} adapter={internalResourceAdapter} onClose={()=>{editSequence.current++;setResourceEditor(null);}} onSaved={()=>{setResourceEditor(null);void load();}}/>}
  {editor&&<Modal title="编辑资源与资料" wide busy={busy} onClose={()=>{editSequence.current++;setEditor(null);}} feedback={editError&&<p className="form-error" role="alert">{editError}</p>}><ArchiveForm key={editor.id+editor.version} type={editor.type} initial={editor} busy={busy} setBusy={setBusy} onReload={async()=>{try{const r=await api<{archive:Archive}>('/archives/'+editor.id);setEditor(r.archive);setEditError('');}catch(e){setEditError((e as Error).message);}}} onSaved={async()=>{setEditor(null);setNotice('资源与资料已保存');await load();}}/></Modal>}
 </>;
}
