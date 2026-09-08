import React,{useEffect,useRef,useState,type FormEvent} from 'react';
import {api,type Member} from './api';
import {Avatar} from './Avatar';
import {Modal} from './Modal';
import {PageError} from './ConnectionPages';
import type {Archive,BoundMember} from '../server/archives';
import {ArchiveStateForm,StateFields} from './ArchiveStateForm';
import {isWorkState,memberLabel} from '../shared/archive-states';
import './archives.css';

type Kind='person'|'org';
type EventItem={id:string;seq:number;kind:string;actor_id:string;actor_name:string;source:string;created_at:string;before:Record<string,unknown>|null;after:Record<string,unknown>|null};
type Preference={query:string;selected:string|null};
function preferences(key:string):Preference{try{return {query:'',selected:null,...JSON.parse(localStorage.getItem(key)??'{}')};}catch{return {query:'',selected:null};}}
const date=(value:string)=>new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
export function ArchivesPage({actor,type}:{actor:Member;type:Kind}){
 const prefKey=`cts:${actor.id}:${type}:archives`,[pref,setPref]=useState(()=>preferences(prefKey));
 const[query,setQuery]=useState(pref.query),[items,setItems]=useState<Archive[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 const[dialog,setDialog]=useState<'create'|Archive|null>(null),[stateDialog,setStateDialog]=useState<Archive|null>(null),[busy,setBusy]=useState(false),[selected,setSelected]=useState<Archive|null>(null);
 const request=useRef(0),label=type==='person'?'人物':'组织';
 useEffect(()=>{try{localStorage.setItem(prefKey,JSON.stringify(pref));}catch{/* Current-page preferences still work without storage. */}},[prefKey,pref]);
 useEffect(()=>{const timer=setTimeout(()=>setPref(p=>({...p,query})),250);return()=>clearTimeout(timer);},[query]);
 async function load(before?:string){
  const sequence=++request.current;setLoading(true);setError('');
  try{const r=await api<{archives:Archive[];next_cursor:string|null}>('/archives?'+new URLSearchParams({type,query:pref.query,...(before?{before}:{})}));if(sequence!==request.current)return;setItems(old=>before?[...old,...r.archives]:r.archives);setCursor(r.next_cursor);}catch(e){if(sequence===request.current)setError((e as Error).message);}finally{if(sequence===request.current)setLoading(false);}
 }
 useEffect(()=>{void load();return()=>{request.current++;};},[type,pref.query,revision]);
 function choose(id:string|null){setPref(p=>({...p,selected:id}));setSelected(null);}
 async function saved(id:string,changed:boolean){setDialog(null);setStateDialog(null);choose(id);setRevision(v=>v+1);setNotice(changed?'档案已保存':'资料没有变化');}
 return <main className={'archives-workspace '+(pref.selected?'has-selection':'')}>
  <section className="archives-list-panel" aria-label={`${label}档案列表`}>
   <div className="archives-heading"><div><p className="eyebrow">共同观察</p><h1>{label}档案</h1></div><button className="button primary" onClick={()=>setDialog('create')}>新建{label}</button></div>
   <div className="archives-search"><input aria-label="搜索档案" placeholder="搜索名称、联系方式" value={query} maxLength={200} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="清空搜索" onClick={()=>setQuery('')}>×</button>}</div>
   <div className="archives-caption"><span>{items.length} 个档案{cursor?' · 可继续加载':''}</span><span>最近更新 ↓</span></div>
   <PageError error={error} retry={()=>void load()}/>
   <div className="archives-rows">{items.map(a=><button key={a.id} className={'archive-row '+(pref.selected===a.id?'selected':'')} onClick={()=>choose(a.id)} aria-label={`查看${a.name}`}><Avatar name={a.name} type={a.type}/><div className="archive-row-content"><div className="archive-row-title"><h2>{a.name}</h2></div><div className="archive-current"><span className={'state-badge small '+(a.closed?'closed':'')}>{a.status}</span>{a.members.length>0&&<span className="archive-assignees">{memberLabel(a.type,a.status)} · {a.members.map(m=>m.name+(m.frozen?'（冻结）':'')).join('、')}</span>}</div><p className="archive-row-excerpt">还没有观察记录</p><div className="archive-row-footer"><span>{a.observation_count} 条观察</span><time>{date(a.updated_at)}</time></div></div></button>)}</div>
   {loading?<p className="archive-list-message" role="status">正在读取档案…</p>:!items.length?<div className="archive-list-message"><h2>{query?'没有找到匹配档案':'从第一个档案开始'}</h2><p>{query?'试试昵称或联系方式。':`把值得关注的${label}留在这里，慢慢积累观察。`}</p></div>:cursor&&<button className="button archive-load" onClick={()=>void load(cursor)}>加载更多档案</button>}
  </section>
  <section className="archive-detail-panel" aria-label="档案详情">
   {pref.selected?<ArchiveDetail key={pref.selected} id={pref.selected} revision={revision} onLoaded={setSelected} onBack={()=>choose(null)} onEdit={()=>selected&&setDialog(selected)} onState={()=>selected&&setStateDialog(selected)} notice={notice}/>:<div className="archive-welcome"><p className="eyebrow">持续观察 · 共同沉淀</p><Avatar type={type} size="large"/><h2>留意那些<br/>值得了解的{label==='人物'?'人':'伙伴'}。</h2><p>从左侧打开一份档案，或创建新的关注对象。</p></div>}
  </section>
  {dialog&&<Modal title={dialog==='create'?`新建${label}档案`:'编辑档案资料'} busy={busy} onClose={()=>setDialog(null)}><ArchiveForm key={dialog==='create'?'create':dialog.id+dialog.version} type={type} initial={dialog==='create'?undefined:dialog} busy={busy} setBusy={setBusy} onSaved={saved} onReload={async()=>{if(dialog==='create')return;const r=await api<{archive:Archive}>('/archives/'+dialog.id);setDialog(r.archive);setRevision(n=>n+1);}}/></Modal>}
  {stateDialog&&<Modal title={stateDialog.closed?'重新开启档案':'状态与成员'} busy={busy} onClose={()=>setStateDialog(null)}><ArchiveStateForm key={stateDialog.id+stateDialog.version} archive={stateDialog} busy={busy} setBusy={setBusy} onSaved={saved} onReload={async()=>{const r=await api<{archive:Archive}>('/archives/'+stateDialog.id);setStateDialog(r.archive);setRevision(n=>n+1);}}/></Modal>}
 </main>;
}
function ArchiveDetail({id,revision,onLoaded,onBack,onEdit,onState,notice}:{id:string;revision:number;onLoaded:(a:Archive)=>void;onBack:()=>void;onEdit:()=>void;onState:()=>void;notice:string}){
 const[archive,setArchive]=useState<Archive|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[copy,setCopy]=useState('');
 useEffect(()=>{let cancelled=false;setError('');api<{archive:Archive}>('/archives/'+id).then(r=>{if(!cancelled){setArchive(r.archive);onLoaded(r.archive);}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[id,revision,retry]);
 async function copyContact(value:string){try{await navigator.clipboard.writeText(value);setCopy('联系方式已复制');}catch{setCopy('复制未完成，请选择联系方式文字复制');}}
 return <><div className="archive-detail-top"><button className="button quiet archive-back" onClick={onBack}>← 返回列表</button><span className="eyebrow">观察档案</span>{archive&&!archive.closed&&<button className="button" onClick={onEdit}>编辑资料</button>}</div><PageError error={error} retry={()=>setRetry(n=>n+1)}/>{!archive&&!error?<p className="archive-list-message" role="status">正在打开档案…</p>:archive&&<>
  <div className="archive-profile"><div className="archive-identity"><Avatar name={archive.name} type={archive.type} size="large"/><div><p className="eyebrow">{archive.type==='person'?'人物':'组织'} / {archive.closed?'已关闭':'持续观察'}</p><h1>{archive.name}</h1><span className={'state-badge '+(archive.closed?'closed':'')}>{archive.status}</span></div></div>
   {archive.closed&&<p className="archive-readonly">档案已关闭，当前内容只读。</p>}<div className="archive-responsibility"><div><span>{memberLabel(archive.type,archive.status)}</span><p>{archive.members.length?archive.members.map(m=>m.name+(m.frozen?'（已冻结）':'')).join('、'):'暂未关联成员'}</p></div><button className="button" onClick={onState}>{archive.closed?'重新开启':'调整状态与成员'}</button></div>
   <dl className="archive-contacts">{archive.contacts.map((c,i)=><div key={i}><dt>{c.type}</dt><dd><span>{c.value}</span><button className="button quiet" onClick={()=>void copyContact(c.value)} aria-label={`复制${c.type}${c.value}`}>复制</button>{c.note&&<small>{c.note}</small>}</dd></div>)}</dl>
   {archive.links.length>0&&<ul className="archive-links">{archive.links.map((l,i)=><li key={i}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label||l.url} ↗</a></li>)}</ul>}
   {!archive.contacts.length&&!archive.links.length&&<p className="archive-no-contact">暂未填写联系方式与资料链接</p>}{copy&&<p className="form-notice" role="status">{copy}</p>}{notice&&<p className="form-notice" role="status">{notice}</p>}
  </div><div className="archive-content-heading"><h2>实体历史线</h2><span>{archive.observation_count} 条观察</span></div><ArchiveEvents id={id} revision={revision}/>
 </>}</>;
}
const eventKinds:Record<string,string>={'archive.created':'创建档案','archive.profile_changed':'修改基础资料','archive.state_changed':'变更业务状态','archive.members_changed':'调整关联成员','archive.closed':'已关闭','archive.reopened':'已重新开启'};
function eventValue(value:unknown):string{if(value===undefined||value===null||value==='')return '未填写';if(Array.isArray(value))return value.length?value.map(v=>typeof v==='object'?('name'in v?v.name+(v.frozen?'（已冻结）':''):'url'in v?`${v.label||'链接'} ${v.url}`:`${v.type} ${v.value}${v.note?'（'+v.note+'）':''}`):String(v)).join('；'):'未填写';return String(value);}
function ArchiveEvents({id,revision}:{id:string;revision:number}){
 const[events,setEvents]=useState<EventItem[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 async function load(before?:string){setLoading(true);setError('');try{const r=await api<{events:EventItem[];next_cursor:string|null}>(`/archives/${id}/events`+(before?'?before='+before:''));setEvents(old=>before?[...old,...r.events]:r.events);setCursor(r.next_cursor);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[id,revision]);
 const fields:Record<string,string>={name:'名称',contacts:'联系方式',links:'资料链接',status:'业务状态',type:'档案类型',members:'当前成员'};
 return <div className="archive-events"><PageError error={error} retry={()=>void load()}/>{events.map(e=><article key={e.id} className="archive-event"><div className="archive-event-marker" aria-hidden="true">◇</div><div><h3>{eventKinds[e.kind]??e.kind}</h3><p className="archive-event-byline">{e.actor_name} · {e.source==='mcp'?'MCP':'网页'} · {date(e.created_at)}</p>{e.kind!=='archive.created'&&<ul>{Object.keys(e.after??{}).filter(k=>JSON.stringify(e.before?.[k])!==JSON.stringify(e.after?.[k])).map(k=><li key={k}><strong>{fields[k]??k}</strong><p><span>{eventValue(e.before?.[k])}</span> → <span>{eventValue(e.after?.[k])}</span></p></li>)}</ul>}</div></article>)}{loading?<p role="status">正在读取历史…</p>:cursor?<button className="button" onClick={()=>void load(cursor)}>更早的动态</button>:<p className="archive-history-end">已到历史起点</p>}</div>;
}
function ArchiveForm({type,initial,busy,setBusy,onSaved,onReload}:{type:Kind;initial?:Archive;busy:boolean;setBusy:(b:boolean)=>void;onSaved:(id:string,changed:boolean)=>Promise<void>;onReload:()=>Promise<void>}){
 const[name,setName]=useState(initial?.name??''),[contacts,setContacts]=useState(initial?.contacts??[]),[links,setLinks]=useState(initial?.links??[]),[error,setError]=useState(''),[requestId]=useState(()=>crypto.randomUUID()),[similar,setSimilar]=useState<Archive[]>([]),[status,setStatus]=useState('视奸观察'),[members,setMembers]=useState<BoundMember[]>([]);
 useEffect(()=>{if(initial||!name.trim()){setSimilar([]);return;}let cancelled=false;const timer=setTimeout(()=>{api<{archives:Archive[]}>('/archives?'+new URLSearchParams({type,query:name,limit:'3'})).then(r=>{if(!cancelled)setSimilar(r.archives);}).catch(()=>{});},350);return()=>{cancelled=true;clearTimeout(timer);};},[name,initial,type]);
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await api<{id:string;changed:boolean}>(initial?'/archives/update':'/archives/create',{...(initial?{id:initial.id,expected_version:initial.version}:{type}),name,contacts,links,...(!initial?{status,member_ids:members.map(m=>m.id)}:{}),request_id:requestId});await onSaved(r.id,r.changed);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <form className="manage-form archive-form" onSubmit={save}>
  <label>{type==='person'?'昵称':'组织名称'}<input required maxLength={120} autoFocus value={name} onChange={e=>setName(e.target.value)}/></label>
  {similar.length>0&&<p className="similar-archives">已有相似档案：{similar.map(a=>a.name).join('、')}。同名不同对象可以继续创建。</p>}
  <fieldset><legend>联系方式 <small>可选</small></legend>{contacts.map((c,i)=><div className="archive-field-row" key={i}><div className="contact-main"><label>类型<select value={c.type} aria-label={`联系方式${i+1}类型`} onChange={e=>setContacts(old=>old.map((v,n)=>n===i?{...v,type:e.target.value}:v))}>{['QQ','微信','邮箱','电话','网站','其他',...(!['QQ','微信','邮箱','电话','网站','其他'].includes(c.type)?[c.type]:[])].map(v=><option key={v}>{v}</option>)}</select></label><label>联系方式<input required value={c.value} maxLength={500} aria-label={`联系方式${i+1}`} onChange={e=>setContacts(old=>old.map((v,n)=>n===i?{...v,value:e.target.value}:v))}/></label><button type="button" className="icon-close" aria-label={`移除联系方式${i+1}`} onClick={()=>setContacts(old=>old.filter((_,n)=>n!==i))}>×</button></div><label>备注<input value={c.note} maxLength={500} aria-label={`联系方式${i+1}备注`} onChange={e=>setContacts(old=>old.map((v,n)=>n===i?{...v,note:e.target.value}:v))}/></label></div>)}<button type="button" className="button quiet" disabled={contacts.length>=20} onClick={()=>setContacts(old=>[...old,{type:'QQ',value:'',note:''}])}>＋ 添加联系方式</button></fieldset>
  <fieldset><legend>资料链接 <small>可选</small></legend>{links.map((l,i)=><div className="archive-field-row" key={i}><label>链接名称<input value={l.label} maxLength={100} aria-label={`资料链接${i+1}名称`} onChange={e=>setLinks(old=>old.map((v,n)=>n===i?{...v,label:e.target.value}:v))}/></label><div className="link-main"><label>网址<input type="url" required maxLength={2000} value={l.url} aria-label={`资料链接${i+1}网址`} onChange={e=>setLinks(old=>old.map((v,n)=>n===i?{...v,url:e.target.value}:v))}/></label><button type="button" className="icon-close" aria-label={`移除资料链接${i+1}`} onClick={()=>setLinks(old=>old.filter((_,n)=>n!==i))}>×</button></div></div>)}<button type="button" className="button quiet" disabled={links.length>=20} onClick={()=>setLinks(old=>[...old,{label:'',url:''}])}>＋ 添加资料链接</button></fieldset>
  {!initial&&<StateFields type={type} status={status} onStatus={s=>{setStatus(s);setMembers([]);}} members={members} onMembers={setMembers}/>}
  <PageError error={error} retry={initial?()=>void onReload().catch(e=>setError(e.message)):undefined} retryLabel="重新读取并替换表单"/><div className="dialog-actions"><button className="button primary" disabled={busy||(!initial&&isWorkState(type,status)&&members.length===0)}>{busy?'正在保存…':initial?'保存资料':'创建档案'}</button></div>
 </form>;
}
