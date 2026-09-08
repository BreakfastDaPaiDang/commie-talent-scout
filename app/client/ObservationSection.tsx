import React,{useEffect,useRef,useState,type FormEvent} from 'react';
import {api,type Member} from './api';
import {Modal} from './Modal';
import {Avatar} from './Avatar';
import {PageError} from './ConnectionPages';
import {useObservationDraft} from './draft-store';
import type {Archive} from '../server/archives';
import type {Observation} from '../server/observations';
import './observations.css';
import {TagChip,TagEvidence} from './TagsSection';
import type {TagBinding} from '../server/tag-state';

type TimelineEvent={id:string;seq:number;kind:string;actor_name:string;source:string;created_at:string;observation_id:string|null;observation:Observation|null;before:Record<string,unknown>|null;after:Record<string,unknown>|null};
const time=(value:string)=>new Date(value).toLocaleString('zh-CN');
function localTime(value:string|null){if(!value)return '';const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function isoTime(value:string){return value?new Date(value).toISOString():null;}
const kinds:Record<string,string>={'archive.tags_changed':'整理标签','archive.created':'创建档案','archive.profile_changed':'修改基础资料','archive.state_changed':'变更业务状态','archive.members_changed':'调整关联成员','archive.closed':'已关闭','archive.reopened':'已重新开启','observation.created':'发布观察','observation.edited':'编辑观察'};
const fields:Record<string,string>={name:'名称',contacts:'联系方式',links:'资料链接',status:'业务状态',members:'当前成员',content_version:'内容版本'};
function readingPosition(key:string){try{const value=JSON.parse(sessionStorage.getItem(key)??'null');return {top:typeof value==='number'?value:Number(value?.top??0),pages:Math.max(1,Math.min(100,Number(value?.pages??1))),mode:value?.mode==='observations'?'observations' as const:'all' as const};}catch{return {top:0,pages:1,mode:'all' as const};}}
function value(v:unknown):string{if(v===null||v===undefined||v==='')return '未填写';if(Array.isArray(v))return v.length?v.map(x=>x.name?x.name+(x.frozen?'（已冻结）':''):x.url?`${x.label||'链接'} ${x.url}`:`${x.type} ${x.value}${x.note?'（'+x.note+'）':''}`).join('、'):'未填写';return String(v);}
export function ObservationSection({actor,archive,onChanged}:{actor:Member;archive:Archive;onChanged:()=>void}){
 const positionKey=`cts:${actor.id}:${archive.id}:reading`,initialPosition=useRef(readingPosition(positionKey));
 const[mode,setMode]=useState<'all'|'observations'>(initialPosition.current.mode),[events,setEvents]=useState<TimelineEvent[]>([]),[records,setRecords]=useState<Observation[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[edit,setEdit]=useState<Observation|null>(null),[history,setHistory]=useState<Observation|null>(null),[busy,setBusy]=useState(false);
 const serial=useRef(0),restored=useRef(false),pages=useRef(0);
 async function load(before?:string){const n=++serial.current;setLoading(true);setError('');try{
  if(mode==='all'){const r=await api<{events:TimelineEvent[];next_cursor:string|null}>(`/archives/${archive.id}/timeline`+(before?'?before='+before:''));if(n!==serial.current)return;setEvents(old=>before?[...old,...r.events]:r.events);setCursor(r.next_cursor);}
  else{const r=await api<{observations:Observation[];next_cursor:string|null}>('/observations?'+new URLSearchParams({archive_id:archive.id,...(before?{before}:{})}));if(n!==serial.current)return;setRecords(old=>before?[...old,...r.observations]:r.observations);setCursor(r.next_cursor);}
  pages.current=before?pages.current+1:1;
 }catch(e){if(n===serial.current)setError((e as Error).message);}finally{if(n===serial.current)setLoading(false);}}
 useEffect(()=>{void load();return()=>{serial.current++;};},[archive.id,archive.version,mode]);
 useEffect(()=>{
  const panel=document.querySelector('.archive-detail-panel');if(!panel)return;
  const save=()=>{if(!restored.current)return;try{sessionStorage.setItem(positionKey,JSON.stringify({top:panel.scrollTop,pages:pages.current,mode}));}catch{}};panel.addEventListener('scroll',save,{passive:true});return()=>panel.removeEventListener('scroll',save);
 },[positionKey,mode]);
 useEffect(()=>{if(loading||error||restored.current)return;if(cursor&&pages.current<initialPosition.current.pages){void load(cursor);return;}restored.current=true;requestAnimationFrame(()=>{const panel=document.querySelector('.archive-detail-panel');if(panel)panel.scrollTop=initialPosition.current.top;});},[loading,error,cursor,positionKey]);
 function changeMode(next:'all'|'observations'){restored.current=true;setMode(next);}
 async function saved(){setEdit(null);setNotice('观察已保存');onChanged();}
 function renderRecord(record:Observation){return <ObservationCard key={record.id} record={record} onEdit={()=>setEdit(record)} onHistory={()=>setHistory(record)}/>;}
 return <><ObservationComposer actor={actor} archive={archive} onPublished={()=>{setNotice('观察已发布');onChanged();}}/>
  <div className="observation-toolbar"><div className="observation-tabs" aria-label="历史内容筛选"><button aria-pressed={mode==='all'} onClick={()=>changeMode('all')}>全部动态</button><button aria-pressed={mode==='observations'} onClick={()=>changeMode('observations')}>仅观察记录</button></div><span>{archive.observation_count} 条观察</span></div>
  <div className="observation-stream"><PageError error={error} retry={()=>void load()}/>{notice&&<p className="form-notice" role="status">{notice}</p>}
   {mode==='observations'?records.map(renderRecord):events.map(e=>e.observation?renderRecord(e.observation):<article key={e.id} className="compact-event" id={'event-'+e.id}><span aria-hidden="true">◇</span><div><p><strong>{kinds[e.kind]??e.kind}</strong><small>{e.actor_name} · {time(e.created_at)} · {e.source==='mcp'?'MCP':'网页'}</small></p>{e.kind==='archive.tags_changed'?<details><summary>查看标签变化</summary><TagEventChange before={e.before as unknown as TagBinding[]} after={e.after as unknown as TagBinding[]}/></details>:e.before&&<details><summary>查看变化</summary><ul>{Object.keys(e.after??{}).filter(k=>k!=='id'&&JSON.stringify(e.before?.[k])!==JSON.stringify(e.after?.[k])).map(k=><li key={k}>{fields[k]??k}：{value(e.before?.[k])} → {value(e.after?.[k])}</li>)}</ul></details>}</div></article>)}
   {loading?<p className="stream-status" role="status">正在读取观察与动态…</p>:cursor?<button className="button" onClick={()=>void load(cursor)}>更早的{mode==='all'?'动态':'观察'}</button>:<p className="stream-status">{mode==='observations'&&!records.length?'还没有观察记录，写下第一条吧。':'已到历史起点'}</p>}
  </div>
  {edit&&<Modal title="编辑观察" busy={busy} onClose={()=>setEdit(null)}><ObservationEdit key={edit.id+edit.version} record={edit} busy={busy} setBusy={setBusy} onSaved={saved} onReload={async()=>setEdit((await api<{observation:Observation}>('/observations/'+edit.id)).observation)}/></Modal>}
  {history&&<Modal title="观察版本历史" onClose={()=>setHistory(null)}><ObservationVersions record={history}/></Modal>}
 </>;
}
function ObservationCard({record,onEdit,onHistory}:{record:Observation;onEdit:()=>void;onHistory:()=>void}){
 return <article className="observation-card" id={'observation-'+record.id}><header><Avatar name={record.author_name} size="tiny"/><div><strong>{record.author_name}</strong><p>提交于 {time(record.created_at)}{record.content_version>1&&<span> · 已编辑 {time(record.updated_at)}</span>}</p></div><div className="observation-actions">{record.editable&&<button className="button quiet" onClick={onEdit}>编辑</button>}<button className="button quiet" onClick={onHistory}>历史</button></div></header>{record.occurred_at&&<p className="observation-occurred">观察发生于 {time(record.occurred_at)}</p>}<div className="observation-body">{record.body}</div></article>;
}
function ObservationComposer({actor,archive,onPublished}:{actor:Member;archive:Archive;onPublished:()=>void}){
 const{store,draft}=useObservationDraft(actor.id,archive.id),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{void store.load().catch(()=>{});return()=>{void store.flush().catch(()=>{});};},[store]);
 useEffect(()=>{if(draft.body)setOpen(true);},[draft.body]);
 async function publish(e:FormEvent){e.preventDefault();setBusy(true);setError('');let published=false;try{await store.flush();const current=store.snapshot();if(!current.publishId)throw new Error('草稿尚未保存，请稍后重试');await api('/observations/create',{archive_id:archive.id,body:current.body,occurred_at:current.occurred_at,request_id:current.publishId});published=true;onPublished();await store.clearPublished();setOpen(false);}catch(e){setError(published?'观察已发布，草稿清理尚未完成；重新读取后可核对。':(e as Error).message);}finally{setBusy(false);}}
 async function clearAlreadyPublished(){setBusy(true);setError('');try{await store.clearPublished();setOpen(false);onPublished();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(archive.closed)return draft.body?<div className="closed-draft-note">你有一份尚未发布的草稿，已保留。档案重新开启后可继续发布。</div>:null;
 return <section className={'observation-composer '+(open?'expanded':'')}>
  {!open?<button className="start-observation" onClick={()=>setOpen(true)}><span aria-hidden="true">＋</span> 写一条观察<span>留下一件具体的事</span></button>:<form onSubmit={publish}><div className="composer-heading"><h2>新的观察</h2><button className="button quiet" type="button" onClick={()=>setOpen(false)} disabled={busy}>收起</button></div><label className="sr-only" htmlFor={'observation-body-'+archive.id}>观察正文</label><textarea id={'observation-body-'+archive.id} value={draft.body} maxLength={100000} rows={7} placeholder="发生了什么？你从中观察到了什么？" onChange={e=>store.edit({body:e.target.value})} disabled={busy||!draft.loaded}/><div className="composer-meta"><label>观察发生时间 <small>可选，补录时填写</small><input type="datetime-local" value={localTime(draft.occurred_at)} disabled={busy||!draft.loaded} onChange={e=>store.edit({occurred_at:isoTime(e.target.value)})}/></label><button className="button primary" disabled={busy||!draft.loaded||!draft.body.trim()||!!draft.publishedId}>{busy?'正在发布…':'发布观察'}</button></div>
   <p className={'draft-status '+(draft.phase==='error'?'error':'')} role="status">{draft.phase==='loading'?'正在读取草稿…':draft.phase==='saving'?'正在保存草稿…':draft.phase==='unsaved'?'草稿尚未保存':draft.phase==='error'?'草稿未保存：'+draft.error:'草稿已保存到你的账号'}<small>草稿仅本人可见，最近保存后保留 30 天；刷新、退出后可继续。</small></p>
   {draft.phase==='error'&&<div className="inline-actions"><button className="button" type="button" onClick={()=>void store.flush().catch(()=>{})}>重试保存草稿</button><button className="button quiet" type="button" onClick={()=>void store.discardLocal().catch(()=>{})}>重新读取云端草稿并替换输入</button></div>}
   {draft.publishedId&&<p className="form-notice">这份草稿已经发布，未重复创建。<button className="button quiet" type="button" onClick={()=>void clearAlreadyPublished()} disabled={busy}>清除已发布草稿</button></p>}
   <PageError error={error}/>
  </form>}
 </section>;
}
function ObservationEdit({record,busy,setBusy,onSaved,onReload}:{record:Observation;busy:boolean;setBusy:(b:boolean)=>void;onSaved:()=>Promise<void>;onReload:()=>Promise<void>}){
 const[body,setBody]=useState(record.body),[occurred,setOccurred]=useState(record.occurred_at),[requestId]=useState(()=>crypto.randomUUID()),[error,setError]=useState('');
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('/observations/update',{id:record.id,expected_version:record.version,body,occurred_at:occurred,request_id:requestId});await onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <form className="manage-form observation-edit-form" onSubmit={save}><p>原作者：{record.author_name}。保存后保留当前版本。</p><label>观察正文<textarea value={body} onChange={e=>setBody(e.target.value)} maxLength={100000} rows={13} required disabled={busy}/></label><label>观察发生时间<input type="datetime-local" value={localTime(occurred)} onChange={e=>setOccurred(isoTime(e.target.value))} disabled={busy}/></label><PageError error={error} retry={()=>void onReload().catch(e=>setError(e.message))} retryLabel="重新读取并替换表单"/><div className="dialog-actions"><button className="button primary" disabled={busy||!body.trim()}>{busy?'正在保存…':'保存新版本'}</button></div></form>;
}
function ObservationVersions({record}:{record:Observation}){
 const[versions,setVersions]=useState<{version:number;body:string;occurred_at:string|null;editor_name:string;created_at:string}[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 async function load(before?:string){setLoading(true);setError('');try{const r=await api<{versions:typeof versions;next_cursor:string|null}>(`/observations/${record.id}/versions`+(before?'?before='+before:''));setVersions(old=>before?[...old,...r.versions]:r.versions);setCursor(r.next_cursor);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[record.id]);
 return <div className="observation-versions"><p>原作者：{record.author_name} · 旧版本保留当时的正文与发生时间。</p><PageError error={error} retry={()=>void load()}/>{versions.map(v=><article key={v.version}><h3>版本 {v.version}</h3><p>{v.editor_name} · {time(v.created_at)}</p>{v.occurred_at&&<p>观察发生于 {time(v.occurred_at)}</p>}<div className="observation-body">{v.body}</div></article>)}{loading?<p role="status">正在读取旧版本…</p>:cursor?<button className="button" onClick={()=>void load(cursor)}>更早的版本</button>:<p>已到第一个版本</p>}</div>;
}

function TagEventChange({before,after}:{before:TagBinding[];after:TagBinding[]}){return <div className="tag-event-change">{[{title:'修改前',items:before},{title:'修改后',items:after}].map(group=><section key={group.title}><h4>{group.title}</h4>{group.items.length?group.items.map(t=><div key={t.tag_id}><TagChip tag={t}/><p>{t.description}</p><TagEvidence items={t.evidence}/></div>):<p>无绑定</p>}</section>)}</div>;}
