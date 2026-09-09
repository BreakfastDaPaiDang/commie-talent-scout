import {ComposerFrame,ObservationFrame,RecordBody,TimelineTabs} from '../ui/Workspace';
import {ActivityStream} from './ActivityStream';
import {ReadBoundary,Highlight} from './Reading';
import type {ReadDelivery} from '../server/reading';
import {pasteImages,ImagePicker,ImageGallery,type AttachmentInfo} from './Images';
import React,{useEffect,useRef,useState,type FormEvent} from 'react';
import {api,type Member} from './api';
import {Modal,ModalActions} from './Modal';
import {Avatar} from './Avatar';
import {PageError} from './ConnectionPages';
import {useObservationDraft} from './draft-store';
import type {Archive} from '../server/archives';
import type {Observation} from '../server/observations';
import './observations.css';
import {TagChip,TagEvidence} from './TagsSection';
import {MaterialsSection} from './MaterialsSection';
import type {TagBinding} from '../server/tag-state';

export type ObservationFocus={event_id?:string;observation_id?:string;query?:string;key:string};
type TimelineEvent={is_read?:boolean;reading?:ReadDelivery|null;id:string;archive_id:string;actor_id:string;seq:number;kind:string;actor_name:string;source:string;created_at:string;observation_id:string|null;observation:Observation|null;before:Record<string,unknown>|null;after:Record<string,unknown>|null};
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
const kinds:Record<string,string>={'material.uploaded':'上传材料','material.updated':'修改材料','material.deleted':'删除材料','material.restored':'恢复材料','material.purged':'清除材料','material.capacity_changed':'调整材料容量','archive.deleted':'删除档案','archive.restored':'恢复档案','observation.deleted':'删除观察','observation.restored':'恢复观察','archive.avatar_changed':'修改头像','archive.tags_changed':'整理标签','archive.created':'创建档案','archive.profile_changed':'修改基础资料','archive.state_changed':'变更业务状态','archive.members_changed':'调整关联成员','archive.closed':'已关闭','archive.reopened':'已重新开启','observation.created':'发布观察','observation.edited':'编辑观察'};
const fields:Record<string,string>={name:'名称',contacts:'联系方式',links:'资料链接',status:'业务状态',members:'当前成员',content_version:'内容版本',deleted:'已删除'};
function readingPosition(key:string){try{const value=JSON.parse(sessionStorage.getItem(key)??'null');return {top:typeof value==='number'?value:Number(value?.top??0),pages:Math.max(1,Math.min(100,Number(value?.pages??1))),mode:value?.mode==='deleted'?'deleted' as const:value?.mode==='observations'?'observations' as const:'all' as const};}catch{return {top:0,pages:1,mode:'all' as const};}}
function value(v:unknown):string{if(typeof v==='boolean')return v?'是':'否';if(v===null||v===undefined||v==='')return '未填写';if(Array.isArray(v))return v.length?v.map(x=>x.name?x.name+(x.frozen?'（已冻结）':''):x.url?`${x.label||'链接'} ${x.url}`:`${x.type} ${x.value}${x.note?'（'+x.note+'）':''}`).join('、'):'未填写';return String(v);}
export function ObservationSection({actor,archive,onChanged,focus}:{actor:Member;archive:Archive;onChanged:()=>void;focus?:ObservationFocus}){
 const [materialsOpen,setMaterialsOpen]=useState(()=>{const p=new URLSearchParams(location.search);return p.get('archive')===archive.id&&p.has('material');}),[materialCount,setMaterialCount]=useState(0),[materialsVisited,setMaterialsVisited]=useState(false);
 const paneScroll=useRef({timeline:0,materials:0});
 useEffect(()=>{let stopped=false;api<{count:number}>('/material-capacity/'+archive.id).then(r=>{if(!stopped)setMaterialCount(r.count);}).catch(()=>{});return()=>{stopped=true;};},[archive.id,archive.version]);
 function switchPane(value:string){const panel=document.querySelector('.archive-detail-panel');if(panel)paneScroll.current[materialsOpen?'materials':'timeline']=panel.scrollTop;const next=value==='materials';setMaterialsOpen(next);if(next)setMaterialsVisited(true);else changeMode(value as typeof mode);requestAnimationFrame(()=>{if(panel)panel.scrollTop=paneScroll.current[next?'materials':'timeline'];});}
 const positionKey=`cts:${actor.id}:${archive.id}:reading`,initialPosition=useRef(readingPosition(positionKey));
 const[mode,setMode]=useState<'all'|'observations'|'deleted'>(initialPosition.current.mode),[events,setEvents]=useState<TimelineEvent[]>([]),[records,setRecords]=useState<Observation[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[edit,setEdit]=useState<Observation|null>(null),[history,setHistory]=useState<Observation|null>(null),[busy,setBusy]=useState(false),[stateTarget,setStateTarget]=useState<Observation|null>(null);
 const serial=useRef(0),restored=useRef(!!focus||materialsOpen),pages=useRef(0);
 const[focused,setFocused]=useState<TimelineEvent|Observation|null>(null),[focusError,setFocusError]=useState(''),[focusRetry,setFocusRetry]=useState(0);
 useEffect(()=>{setFocused(null);setFocusError('');if(!focus)return;restored.current=true;let cancelled=false;const path=focus.event_id?'/events/'+focus.event_id:'/observations/'+focus.observation_id;api<{event?:TimelineEvent;observation?:Observation}>(path).then(r=>{if(!cancelled){setFocused(r.event??r.observation??null);if(r.event?.is_read)window.dispatchEvent(new CustomEvent('cts-reading-confirmed',{detail:[r.event.id]}));requestAnimationFrame(()=>document.getElementById('focused-content')?.scrollIntoView({block:'start'}));}}).catch(e=>{if(!cancelled)setFocusError(e.message);});return()=>{cancelled=true;};},[focus?.key,focusRetry,archive.version]);
 async function load(before?:string){const n=++serial.current;setLoading(true);setError('');try{
  if(mode==='all'){const r=await api<{events:TimelineEvent[];next_cursor:string|null}>(`/archives/${archive.id}/timeline`+(before?'?before='+before:''));if(n!==serial.current)return;setEvents(old=>before?[...old,...r.events]:r.events);setCursor(r.next_cursor);}
  else{const r=await api<{observations:Observation[];next_cursor:string|null}>('/observations?'+new URLSearchParams({archive_id:archive.id,deleted:String(mode==='deleted'),...(before?{before}:{})}));if(n!==serial.current)return;setRecords(old=>before?[...old,...r.observations]:r.observations);setCursor(r.next_cursor);}
  pages.current=before?pages.current+1:1;
 }catch(e){if(n===serial.current)setError((e as Error).message);}finally{if(n===serial.current)setLoading(false);}}
 useEffect(()=>{void load();const stale=()=>{void load();setFocusRetry(n=>n+1);};window.addEventListener('cts-reading-stale',stale);return()=>{serial.current++;window.removeEventListener('cts-reading-stale',stale);};},[archive.id,archive.version,mode]);
 useEffect(()=>{
  const panel=document.querySelector('.archive-detail-panel');if(!panel)return;
  const save=()=>{if(!restored.current||materialsOpen)return;try{sessionStorage.setItem(positionKey,JSON.stringify({top:panel.scrollTop,pages:pages.current,mode}));}catch{}};panel.addEventListener('scroll',save,{passive:true});return()=>panel.removeEventListener('scroll',save);
 },[positionKey,mode,materialsOpen]);
 useEffect(()=>{if(loading||error||restored.current)return;if(cursor&&pages.current<initialPosition.current.pages){void load(cursor);return;}restored.current=true;requestAnimationFrame(()=>{const panel=document.querySelector('.archive-detail-panel');if(panel)panel.scrollTop=initialPosition.current.top;});},[loading,error,cursor,positionKey]);
 function changeMode(next:'all'|'observations'|'deleted'){restored.current=true;setMode(next);}
 async function saved(){setEdit(null);setNotice('观察已保存');onChanged();}
 function renderRecord(record:Observation,highlight?:string){return <ObservationCard key={record.id} record={record} highlight={highlight} onEdit={()=>setEdit(record)} onHistory={()=>setHistory(record)} onState={()=>setStateTarget(record)}/>;}
 return <>{!materialsOpen&&focus&&<section className="focused-content" id="focused-content"><p className="eyebrow">{focus.query?'搜索命中':'指定更新'} · {archive.closed?'档案已关闭':'当前档案'}</p><PageError error={focusError} retry={()=>setFocusRetry(n=>n+1)}/>{!focused&&!focusError?<p role="status">正在定位内容…</p>:focused&&('kind' in focused?(focused.observation?renderRecord(focused.observation,focus.query):<EventCard event={focused} expanded/>):renderRecord(focused,focus.query))}</section>}
  <TimelineTabs id={archive.id} value={materialsOpen?'materials':mode} onChange={switchPane} materialCount={materialCount}/>
  {(materialsVisited||materialsOpen)&&<div hidden={!materialsOpen} role="tabpanel" id={`${archive.id}-materials`} aria-labelledby={`${archive.id}-tab-materials`}><MaterialsSection actor={actor} archive={archive} onChanged={onChanged} active={materialsOpen}/></div>}
  <div hidden={materialsOpen}>
  {mode!=='deleted'&&!archive.deleted&&<ObservationComposer actor={actor} archive={archive} onPublished={()=>{setNotice('观察已发布');onChanged();}}/>}
  <div className="timeline observation-stream" role="tabpanel" id={`${archive.id}-timeline`} aria-labelledby={`${archive.id}-tab-${mode}`} tabIndex={0}><PageError error={error} retry={()=>void load()}/>{notice&&<p className="form-notice" role="status">{notice}</p>}
   {mode!=='all'?records.map(r=>renderRecord(r)):<ActivityStream events={events} renderRecord={e=>renderRecord(e.observation!)} renderEvent={e=><EventCard key={e.id} event={e}/>}/>}
   {loading?<p className="stream-status" role="status">正在读取观察与动态…</p>:error?null:cursor?<button className="button" onClick={()=>void load(cursor)}>更早的{mode==='all'?'动态':'观察'}</button>:<p className="stream-status">{mode==='deleted'&&!records.length?'没有你可查看的已删除观察。':mode==='observations'&&!records.length?'还没有观察记录，写下第一条吧。':'已到历史起点'}</p>}
  </div>
  </div>
  {edit&&<Modal title="编辑观察" busy={busy} onClose={()=>setEdit(null)}><ObservationEdit actorId={actor.id} key={edit.id+edit.version} record={edit} busy={busy} setBusy={setBusy} onSaved={saved} onReload={async()=>setEdit((await api<{observation:Observation}>('/observations/'+edit.id)).observation)}/></Modal>}
  {stateTarget&&<Modal title={stateTarget.deleted?'恢复观察':'删除观察'} busy={busy} onClose={()=>setStateTarget(null)}><ObservationState key={stateTarget.id+stateTarget.version} record={stateTarget} busy={busy} setBusy={setBusy} onSaved={()=>{setStateTarget(null);setNotice(stateTarget.deleted?'观察已恢复':'观察已删除，原作者或管理员可在已删除视图恢复');onChanged();}} onReload={async()=>setStateTarget((await api<{observation:Observation}>('/observations/'+stateTarget.id)).observation)}/></Modal>}
  {history&&<Modal title="观察版本历史" onClose={()=>setHistory(null)}><ObservationVersions record={history}/></Modal>}
 </>;
}
function ObservationCard({record,onEdit,onHistory,onState,highlight}:{highlight?:string;record:Observation;onEdit:()=>void;onHistory:()=>void;onState:()=>void}){
 return <ObservationFrame id={'observation-'+record.id} avatar={<Avatar name={record.author_name} src={record.author_avatar_url} size="tiny"/>} author={record.author_name} time={time(record.created_at)} edited={record.content_version>1?'已编辑 '+time(record.updated_at):undefined} onHistory={onHistory} historyLabel={`查看${record.author_name}记录的历史`} deleted={record.deleted} footer={<>{record.editable&&<button onClick={onEdit}>编辑</button>}{(record.deletable||record.restorable)&&<button onClick={onState}>{record.deleted?'恢复记录':'删除'}</button>}</>}>
  {record.deleted&&<p className="form-notice">已由 {record.deleted_by_name??'成员'} 于 {record.deleted_at?time(record.deleted_at):'未知时间'} 删除。正文与图片仅原作者及管理员可见。{!record.restorable&&'所属档案当前只读，暂不可恢复。'}</p>}{record.occurred_at&&<p className="observation-occurred">观察发生于 {time(record.occurred_at)}</p>}<RecordBody body={record.body} className="observation-body reading-content" boundary={<ReadBoundary reading={record.reading} imageOnly={!record.body.trim()}/>} renderText={line=><Highlight text={line} query={highlight}/>}/><ImageGallery images={record.attachments}/>
 </ObservationFrame>;
}
function ObservationComposer({actor,archive,onPublished}:{actor:Member;archive:Archive;onPublished:()=>void}){
 const{store,draft}=useObservationDraft(actor.id,archive.id),[open,setOpen]=useState(false),[pending,setPending]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{void store.load().catch(()=>{});return()=>{void store.flush().catch(()=>{});};},[store]);
 useEffect(()=>{if(draft.body||draft.attachments.length)setOpen(true);},[draft.body,draft.attachments.length]);
 async function publish(e:FormEvent){e.preventDefault();setBusy(true);setError('');let published=false;try{await store.flush();const current=store.snapshot();if(!current.publishId)throw new Error('草稿尚未保存，请稍后重试');await api('/observations/create',{archive_id:archive.id,body:current.body,attachment_ids:current.attachments.map(i=>i.id),request_id:current.publishId});published=true;onPublished();await store.clearPublished();setOpen(false);}catch(e){setError(published?'观察已发布，草稿清理尚未完成；重新读取后可核对。':(e as Error).message);}finally{setBusy(false);}}
 async function clearAlreadyPublished(){setBusy(true);setError('');try{await store.clearPublished();setOpen(false);onPublished();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(archive.closed)return draft.body||draft.attachments.length?<div className="closed-draft-note">你有一份尚未发布的草稿，已保留。档案重新开启后可继续发布。</div>:null;
 return <form className="live-composer-form" onSubmit={publish} onPaste={e=>{if(!busy&&draft.loaded)setError(pasteImages(e,actor.id+':draft:'+archive.id,{purpose:'observation',archive_id:archive.id},draft.attachments.length));}}><ComposerFrame open={open} onOpen={()=>setOpen(true)} textarea={{value:draft.body,onChange:e=>store.edit({body:e.target.value}),maxLength:100000,disabled:busy||!draft.loaded}}>
  <div className="composer-foot"><ImagePicker queueKey={actor.id+':draft:'+archive.id} target={{purpose:'observation',archive_id:archive.id}} value={draft.attachments} onChange={attachments=>store.edit({attachments})} onPending={setPending} disabled={busy||!draft.loaded}/>
  <span className="composer-hint">可粘贴</span><button className="button quiet" type="button" onClick={()=>setOpen(false)}>收起</button><button className="button primary" disabled={busy||pending||!draft.loaded||(!draft.body.trim()&&!draft.attachments.length)||!!draft.publishedId}>{busy?'正在发布…':'发布记录'}</button></div>
   <p className={'draft-status '+(draft.phase==='error'?'error':'')} role="status">{draft.phase==='loading'?'正在读取草稿…':draft.phase==='saving'?'正在保存草稿…':draft.phase==='unsaved'?'草稿尚未保存':draft.phase==='error'?'草稿未保存：'+draft.error:draft.body||draft.attachments.length?'草稿已保存':''}</p>
   {draft.phase==='error'&&<div className="inline-actions"><button className="button" type="button" onClick={()=>void store.flush().catch(()=>{})}>重试保存草稿</button><button className="button quiet" type="button" onClick={()=>void store.discardLocal().catch(()=>{})}>重新读取云端草稿并替换输入</button></div>}
   {draft.publishedId&&<p className="form-notice">这份草稿已经发布，未重复创建。<button className="button quiet" type="button" onClick={()=>void clearAlreadyPublished()} disabled={busy}>清除已发布草稿</button></p>}
   <PageError error={error}/>
 </ComposerFrame></form>;
}

function ObservationEdit({actorId,record,busy,setBusy,onSaved,onReload}:{actorId:string;record:Observation;busy:boolean;setBusy:(b:boolean)=>void;onSaved:()=>Promise<void>;onReload:()=>Promise<void>}){
 const[attachments,setAttachments]=useState(record.attachments),[pending,setPending]=useState(false),[body,setBody]=useState(record.body),[requestId]=useState(()=>crypto.randomUUID()),[error,setError]=useState('');
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('/observations/update',{id:record.id,expected_version:record.version,body,attachment_ids:attachments.map(i=>i.id),occurred_at:record.occurred_at,request_id:requestId});await onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <form className="manage-form observation-edit-form" onSubmit={save} onPaste={e=>{if(!busy)setError(pasteImages(e,actorId+':edit:'+record.id,{purpose:'observation',archive_id:record.archive_id},attachments.length));}}><label>观察正文<textarea value={body} onChange={e=>setBody(e.target.value)} maxLength={100000} rows={13} disabled={busy}/></label><ImagePicker queueKey={actorId+':edit:'+record.id} target={{purpose:'observation',archive_id:record.archive_id}} value={attachments} onChange={setAttachments} onPending={setPending} disabled={busy}/><PageError error={error} retry={()=>void onReload().catch(e=>setError(e.message))} retryLabel="重新读取并替换表单"/><ModalActions><button className="button primary" disabled={busy||pending||(!body.trim()&&!attachments.length)}>{busy?'正在保存…':'保存新版本'}</button></ModalActions></form>;
}
function ObservationVersions({record}:{record:Observation}){
 const[versions,setVersions]=useState<{attachments:AttachmentInfo[];version:number;body:string;occurred_at:string|null;editor_name:string;created_at:string}[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 async function load(before?:string){setLoading(true);setError('');try{const r=await api<{versions:typeof versions;next_cursor:string|null}>(`/observations/${record.id}/versions`+(before?'?before='+before:''));setVersions(old=>before?[...old,...r.versions]:r.versions);setCursor(r.next_cursor);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[record.id]);
 return <div className="observation-versions"><p>原作者：{record.author_name} · 旧版本保留当时的正文、图片与发生时间。</p><PageError error={error} retry={()=>void load()}/>{versions.map(v=><article key={v.version}><h3>版本 {v.version}</h3><p>{v.editor_name} · {time(v.created_at)}</p>{v.occurred_at&&<p>观察发生于 {time(v.occurred_at)}</p>}<div className="observation-body">{v.body}</div><ImageGallery images={v.attachments}/></article>)}{loading?<p role="status">正在读取旧版本…</p>:cursor?<button className="button" onClick={()=>void load(cursor)}>更早的版本</button>:<p>已到第一个版本</p>}</div>;
}

function TagEventChange({before,after}:{before:TagBinding[];after:TagBinding[]}){return <div className="tag-event-change">{[{title:'修改前',items:before},{title:'修改后',items:after}].map(group=><section key={group.title}><h4>{group.title}</h4>{group.items.length?group.items.map(t=><div key={t.tag_id}><TagChip tag={t}/><p>{t.description}</p><TagEvidence items={t.evidence}/></div>):<p>无绑定</p>}</section>)}</div>;}

function ObservationState({record,busy,setBusy,onSaved,onReload}:{record:Observation;busy:boolean;setBusy:(b:boolean)=>void;onSaved:()=>void;onReload:()=>Promise<void>}){
 const[requestId]=useState(()=>crypto.randomUUID()),[error,setError]=useState('');
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('/observations/'+(record.deleted?'restore':'delete'),{id:record.id,expected_version:record.version,request_id:requestId});onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <form className="manage-form" onSubmit={save}><p>原作者：{record.author_name} · 提交于 {time(record.created_at)}</p><p>{record.deleted?'恢复后，其他成员可再次查看这条观察及其历史版本和图片。':'删除后，其他成员将无法读取正文、历史版本和图片。原作者或管理员可在已删除视图恢复。'}</p><PageError error={error} retry={()=>void onReload().catch(e=>setError(e.message))} retryLabel="重新读取当前状态"/><ModalActions><button className="button primary" disabled={busy||!(record.deletable||record.restorable)}>{busy?'正在处理…':record.deleted?'确认恢复':'确认删除'}</button></ModalActions></form>;
}

function EventCard({event:e,expanded=false}:{event:TimelineEvent;expanded?:boolean}){
 const[open,setOpen]=useState(expanded);
 const change=e.kind==='archive.tags_changed'?<TagEventChange before={(e.before??[]) as unknown as TagBinding[]} after={(e.after??[]) as unknown as TagBinding[]}/>:<ul>{Object.keys(e.after??{}).filter(k=>k!=='id'&&JSON.stringify(e.before?.[k])!==JSON.stringify(e.after?.[k])).map(k=><li key={k}>{fields[k]??k}：{e.before?value(e.before[k])+' → ':''}{value(e.after?.[k])}</li>)}</ul>;
 const hasChange=!e.kind.startsWith('material.')&&(e.kind==='archive.tags_changed'||Object.keys(e.after??{}).some(k=>k!=='id'));
 return <article className="system-event compact-event" id={'event-'+e.id}><span className="event-node" aria-hidden="true"/><div><div className={'event-overview '+(!hasChange?'reading-content':'')}>{!hasChange&&<ReadBoundary reading={e.reading}/>}<strong>{kinds[e.kind]??'档案更新'}</strong><small>{e.actor_name} · {time(e.created_at)}</small></div>{hasChange&&<details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>查看{e.before?'变化':'内容'}</summary>{open&&<div className="reading-content"><ReadBoundary reading={e.reading}/>{change}</div>}</details>}</div></article>;

}
