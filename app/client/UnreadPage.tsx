import {CaughtUp,UpdateRow,WorkspaceFrame} from '../ui/Workspace';
import {Avatar} from './Avatar';
import {avatarUrl} from './AvatarEditor';
import {groupActivities} from '../shared/activity-groups';
import React,{useEffect,useRef,useState} from 'react';
import {api,type Member} from './api';
import {ArchivesPage} from './ArchivesPage';
import {PageError} from './ConnectionPages';
import type {ArchiveReadConfirmation} from '../server/archive-reading';
type Entry={actor_id:string;id:string;seq:number;archive_id:string;archive_name:string;type:'person'|'org';closed:number;kind:string;actor_name:string;created_at:string;read?:boolean};
const kinds:Record<string,string>={'material.uploaded':'新增材料','material.updated':'材料更新','material.deleted':'材料已删除','material.restored':'材料已恢复','material.purged':'材料已清除','material.capacity_changed':'材料容量调整','observation.created':'新的观察','observation.edited':'观察已编辑','observation.deleted':'观察已删除','observation.restored':'观察已恢复','archive.created':'新建档案','archive.profile_changed':'资料更新','archive.tags_changed':'标签变化','archive.state_changed':'状态变化','archive.members_changed':'成员变化','archive.closed':'档案已关闭','archive.reopened':'档案已开启','archive.avatar_changed':'头像更新'};
export function UnreadBadge({onCount}:{onCount?:(total:number)=>void}={}){
 const[total,setTotal]=useState<number|null>(null);
 useEffect(()=>{let cancelled=false,sequence=0,timer:ReturnType<typeof setTimeout>;const load=()=>{const n=++sequence;clearTimeout(timer);timer=setTimeout(()=>{if(document.visibilityState==='visible')void api<{total:number}>('/reading').then(r=>{if(!cancelled&&n===sequence){setTotal(r.total);onCount?.(r.total);}}).catch(()=>{});},500);};load();window.addEventListener('cts-reading-confirmed',load);document.addEventListener('visibilitychange',load);return()=>{cancelled=true;clearTimeout(timer);window.removeEventListener('cts-reading-confirmed',load);document.removeEventListener('visibilitychange',load);};},[onCount]);
 return <>{total!==null&&total>0&&<span className="nav-unread">{total}</span>}</>;
}
export function UnreadPage({actor}:{actor:Member}){
 const[items,setItems]=useState<Entry[]>([]),[selected,setSelected]=useState<string|null>(null),[cursor,setCursor]=useState<string|null>(null),[snapshot,setSnapshot]=useState<number|undefined>(),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const serial=useRef(0),current=items.find(e=>e.id===selected),remaining=items.filter(e=>!e.read),complete=!loading&&!error&&!cursor&&items.length>0&&!remaining.length;
 const[queueRevision,setQueueRevision]=useState(0);
 const archiveReads=useRef(new Map<string,ArchiveReadConfirmation>()),eventReads=useRef(new Set<string>());
 const reconcile=(entries:Entry[])=>entries.map(e=>{const opening=archiveReads.current.get(e.archive_id);return eventReads.current.has(e.id)||(opening&&e.seq<=opening.through_seq&&!opening.unread_event_ids.includes(e.id))?{...e,read:true}:e;});
 const hasNext=remaining.some(e=>e.archive_id!==current?.archive_id)||!!cursor;
 async function load(before?:string){const n=++serial.current;if(!before){archiveReads.current.clear();eventReads.current.clear();}setLoading(true);setError('');try{const r=await api<{events:Entry[];snapshot:number;next_cursor:string|null}>('/reading/events?'+new URLSearchParams({...(before?{before,snapshot:String(snapshot)}:{})}));if(n!==serial.current)return;setItems(old=>reconcile(before?[...old,...r.events.filter(e=>!old.some(existing=>existing.id===e.id))]:r.events));setSnapshot(r.snapshot);setCursor(r.next_cursor);if(!before){setSelected(r.events[0]?.id??null);setQueueRevision(value=>value+1);}}catch(e){if(n===serial.current)setError((e as Error).message);}finally{if(n===serial.current)setLoading(false);}}
 useEffect(()=>{
  archiveReads.current.clear();eventReads.current.clear();void load();
  const read=(event:Event)=>{for(const id of (event as CustomEvent<string[]>).detail)eventReads.current.add(id);setItems(reconcile);};
  const opened=(event:Event)=>{const result=(event as CustomEvent<ArchiveReadConfirmation>).detail;if(result.member_id!==actor.id)return;if(result.through_seq>=(archiveReads.current.get(result.archive_id)?.through_seq??-1))archiveReads.current.set(result.archive_id,result);setItems(reconcile);};
  window.addEventListener('cts-reading-confirmed',read);window.addEventListener('cts-archive-reading-confirmed',opened);
  return()=>{serial.current++;window.removeEventListener('cts-reading-confirmed',read);window.removeEventListener('cts-archive-reading-confirmed',opened);};
 },[actor.id]);
 useEffect(()=>{
  if(loading||snapshot===undefined||!cursor||!items.length||remaining.length)return;
  let cancelled=false;const n=serial.current;
  // The unopened pages may consist entirely of the archive just acknowledged.
  // Resolve that stale cursor without making the member click Next to finish.
  void api<{events:Entry[];next_cursor:string|null}>('/reading/events?'+new URLSearchParams({snapshot:String(snapshot),limit:'1'})).then(r=>{
   if(cancelled||n!==serial.current)return;
   setItems(old=>[...old.map(e=>r.events.some(current=>current.id===e.id)?{...e,read:false}:e),...r.events.filter(e=>!old.some(existing=>existing.id===e.id))]);setCursor(r.next_cursor);
  }).catch(e=>{if(!cancelled&&n===serial.current)setError(e.message);});
  return()=>{cancelled=true;};
 },[loading,snapshot,cursor,remaining.length,selected]);
 function chooseEntry(id:string|null){serial.current++;setLoading(false);setError('');setSelected(id);}
 async function next(){
  const n=++serial.current;setLoading(true);setError('');
  try{
   // Ask the shared personal unread query, including beyond the loaded page. A
   // local event list cannot prove an archive is still unread after another read.
   const r=await api<{events:Entry[]}>('/reading/events?'+new URLSearchParams({...(current?{exclude_archive_id:current.archive_id}:{}),snapshot:String(snapshot),limit:'1'}));
   if(n!==serial.current)return;
   const target=r.events[0];
   if(target){setItems(old=>old.some(e=>e.id===target.id)?old.map(e=>e.id===target.id?{...target,read:false}:e):[...old,target]);setSelected(target.id);}
   else{setItems(old=>old.map(e=>e.archive_id===current?.archive_id?e:{...e,read:true}));setCursor(null);}
  }catch(e){if(n===serial.current)setError((e as Error).message);}finally{if(n===serial.current)setLoading(false);}
 }
 return <WorkspaceFrame selected={!!current} list={<>
  <header className="page-head"><div><h1>未读更新</h1></div><button className="button" disabled={loading} onClick={()=>void load()}>刷新队列</button></header>
  <div className="unread-progress"><span>{items.filter(e=>e.read).length} / {items.length}{cursor?'＋':''} 已阅</span><button className="text-button" disabled={loading||!hasNext} onClick={()=>void next()}>下一处未读 →</button></div>
  <PageError error={error} retry={()=>void load(items.length&&cursor?cursor:undefined)}/>
  <section className="updates-list" aria-label="本次未读队列"><p className="section-description">打开档案即清除已有未读。已阅条目保留在本次位置。</p>
  {!loading&&!error&&(!items.length||complete)?<CaughtUp action={<button className="button outline" onClick={()=>{history.pushState(null,'','/');window.dispatchEvent(new PopStateEvent('popstate'));}}>回到人物档案</button>}/>:groupActivities(items).map(group=>{const first=group.events[0],unread=group.events.filter(e=>!e.read);return <React.Fragment key={group.id}><UpdateRow selected={group.events.some(e=>e.id===selected)} onClick={()=>chooseEntry((unread[0]??first).id)} avatar={<Avatar name={first.archive_name} type={first.type} src={avatarUrl('archive',first.archive_id,0)}/>} label={<>{first.type==='person'?'人物':'组织'} · {unread.length?`${unread.length} 项更新`:'已阅'}{first.closed?' · 已关闭':''}</>} name={first.archive_name} excerpt={[...new Set(group.events.map(e=>kinds[e.kind]??'档案更新'))].join('、')} time={`${first.actor_name} · ${new Date(first.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}`} read={!unread.length}/>{group.events.length>1&&<details className="unread-batch-details"><summary>{group.events.length} 项操作 · 展开明细</summary>{group.events.map(e=><button key={e.id} aria-current={e.id===selected} onClick={()=>chooseEntry(e.id)}>{kinds[e.kind]??'档案更新'} · {e.read?'已阅':'未读'}</button>)}</details>}</React.Fragment>;})}
  </section>{loading?<p className="stream-status" role="status">正在读取更新…</p>:cursor&&<button className="button archive-load" onClick={()=>void load(cursor)}>加载更多更新</button>}
 </>} detail={current?<ArchivesPage key={`${actor.id}:${current.archive_id}:${queueRevision}`} actor={actor} type={current.type} detailOnly onNextUnread={!loading&&hasNext?()=>void next():undefined} onClose={()=>chooseEntry(null)} linked={{archiveId:current.archive_id,focus:{event_id:current.id,key:current.id}}}/>:<aside className="selection-rest"><span>选择一条更新，继续观察。</span></aside>}/>;
}
