import {ProfileFields} from '../ui/ArchiveFields';
import {MemberPicker as DirectoryPicker} from '../ui/MemberPicker';
import {ArchiveHead,ArchiveRow,DetailFrame,EntityHeader,IconButton,ScopeToolbar,TabList,WorkspaceFrame} from '../ui/Workspace';
import {Icon} from '../ui/icons';
import {Highlight} from './Reading';
import {statesFor} from '../shared/archive-states';
import type {ObservationFocus} from './ObservationSection';
import {AvatarEditor,avatarUrl} from './AvatarEditor';
import React,{useEffect,useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import {api,type Member} from './api';
import {Avatar} from './Avatar';
import {Modal,ModalActions} from './Modal';
import {PageError} from './ConnectionPages';
import type {Archive,BoundMember} from '../server/archives';
import {ArchiveStateForm,StateFields} from './ArchiveStateForm';
import {isWorkState} from '../shared/archive-states';
import './archives.css';
import {TagsSection,TagSummary} from './TagsSection';
import {ObservationSection} from './ObservationSection';

type Kind='person'|'org';
type Preference={query:string;selected:string|null;scope:'all'|'mine'|'unread';status:string;member_id:string;closed:'all'|'open'|'closed'};
const defaults:Preference={query:'',selected:null,scope:'all',status:'',member_id:'',closed:'all'};
type ListArchive=Archive&{unread_count?:number;search_match?:{observation_id:string;excerpt:string}|null};
function preferences(key:string):Preference{try{return {...defaults,...JSON.parse(localStorage.getItem(key)??'{}')};}catch{return {...defaults};}}
const date=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
export function ArchivesPage({actor,type,linked,detailOnly=false,onNextUnread,onClose}:{actor:Member;type:Kind;linked?:{archiveId:string;focus:ObservationFocus};detailOnly?:boolean;onNextUnread?:()=>void;onClose?:()=>void}){
 const prefKey=`cts:${actor.id}:${type}:archives`,[pref,setPref]=useState(()=>{const saved=preferences(prefKey),linked=new URLSearchParams(location.search).get('archive');return linked&&/^[0-9a-f-]{36}$/i.test(linked)?{...saved,selected:linked}:saved;});
 const[query,setQuery]=useState(pref.query),[items,setItems]=useState<ListArchive[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 const[dialog,setDialog]=useState<'create'|Archive|null>(null),[stateDialog,setStateDialog]=useState<Archive|null>(null),[busy,setBusy]=useState(false),[selected,setSelected]=useState<Archive|null>(null),[draftIds,setDraftIds]=useState<string[]>([]);
 const[counts,setCounts]=useState<Record<string,number>>(),[editTab,setEditTab]=useState('profile');
 const [filtersOpen,setFiltersOpen]=useState(false),[expanded,setExpanded]=useState(false),searchRef=useRef<HTMLInputElement>(null);
 const request=useRef(0),label=type==='person'?'人物':'组织';
 const[focus,setFocus]=useState<ObservationFocus|undefined>(()=>{const p=new URLSearchParams(location.search);return p.has('event')||p.has('observation')?{event_id:p.get('event')??undefined,observation_id:p.get('observation')??undefined,query:p.get('highlight')??undefined,key:location.search}:undefined;}),[directory,setDirectory]=useState<BoundMember[]>([]),[directoryError,setDirectoryError]=useState(''),[directoryRetry,setDirectoryRetry]=useState(0);
 useEffect(()=>{if(linked){setPref(p=>({...p,selected:linked.archiveId}));setFocus(linked.focus);}},[linked?.archiveId,linked?.focus.key]);
 useEffect(()=>{let cancelled=false;setDirectoryError('');void (async()=>{let before:string|null=null,all:BoundMember[]=[];do{const r: {members:BoundMember[];next_cursor:string|null}=await api('/members?'+new URLSearchParams({limit:'100',...(before?{before}:{})}));all.push(...r.members);before=r.next_cursor;}while(before&&!cancelled);if(!cancelled)setDirectory(all);})().catch(e=>{if(!cancelled)setDirectoryError('成员筛选暂不可用：'+e.message);});return()=>{cancelled=true;};},[directoryRetry]);
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>;const changed=()=>{clearTimeout(timer);timer=setTimeout(()=>setRevision(n=>n+1),750);};window.addEventListener('cts-reading-confirmed',changed);window.addEventListener('cts-reading-stale',changed);return()=>{clearTimeout(timer);window.removeEventListener('cts-reading-confirmed',changed);window.removeEventListener('cts-reading-stale',changed);};},[]);
 useEffect(()=>{try{localStorage.setItem(prefKey,JSON.stringify(pref));}catch{/* Current-page preferences still work without storage. */}},[prefKey,pref]);
 useEffect(()=>{const timer=setTimeout(()=>setPref(p=>({...p,query})),250);return()=>clearTimeout(timer);},[query]);
 async function load(before?:string){
  const sequence=++request.current;setLoading(true);setError('');
  try{const r=await api<{archives:ListArchive[];next_cursor:string|null;counts?:Record<string,number>}>('/archives?'+new URLSearchParams({type,query:pref.query,scope:pref.scope,status:pref.status,member_id:pref.member_id,closed:pref.closed,...(before?{before}:{})}));if(sequence!==request.current)return;setItems(old=>before?[...old,...r.archives]:r.archives);setCursor(r.next_cursor);if(r.counts)setCounts(r.counts);}catch(e){if(sequence===request.current)setError((e as Error).message);}finally{if(sequence===request.current)setLoading(false);}
 }
 useEffect(()=>{if(!detailOnly)void load();return()=>{request.current++;};},[type,pref.query,pref.scope,pref.status,pref.member_id,pref.closed,revision,detailOnly]);
 function choose(id:string|null,match?:ListArchive['search_match']){setNotice('');setExpanded(false);if(pref.selected!==id)setSelected(null);setPref(p=>({...p,selected:id}));const next=match?{observation_id:match.observation_id,query:pref.query,key:crypto.randomUUID()}:undefined;setFocus(next);if(!detailOnly){const params=new URLSearchParams();if(id)params.set('archive',id);if(next){params.set('observation',next.observation_id);params.set('highlight',next.query);}history.replaceState(null,'',location.pathname+(params.size?'?'+params:''));}}
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>|undefined;const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>{api<{drafts:{archive_id:string}[]}>('/drafts').then(r=>setDraftIds(r.drafts.map(d=>d.archive_id))).catch(()=>{});},500);};refresh();window.addEventListener('cts-drafts-changed',refresh);return()=>{clearTimeout(timer);window.removeEventListener('cts-drafts-changed',refresh);};},[]);
 async function saved(id:string,changed:boolean,message?:string){setDialog(null);setStateDialog(null);choose(id);setRevision(v=>v+1);setNotice(message??(changed?'档案已保存':'资料没有变化'));}

 useEffect(()=>{if(!['档案已保存','资料没有变化'].includes(notice))return;const timer=setTimeout(()=>setNotice(''),2800);return()=>clearTimeout(timer);},[notice]);
 async function refreshEditor(id:string){const r=await api<{archive:Archive}>('/archives/'+id);setDialog(current=>current&&current!=='create'&&current.id===id&&current.version<=r.archive.version?r.archive:current);setRevision(n=>n+1);}

 const activeFilters=!!(pref.status||pref.member_id||pref.closed!=='all');
 return <><WorkspaceFrame selected={!!pref.selected} expanded={expanded} detailOnly={detailOnly} list={<>
  <ArchiveHead label={label} count={String(items.length).padStart(2,'0')+(cursor?'＋':'')} query={query} onQuery={setQuery} onCreate={()=>{setEditTab('profile');setDialog('create');}} searchRef={searchRef}/>
  <ScopeToolbar counts={counts} scope={pref.scope} onScope={scope=>setPref(p=>({...p,scope:scope as Preference['scope']}))} filtersOpen={filtersOpen} onFilters={()=>setFiltersOpen(v=>!v)} activeFilters={activeFilters} onReset={query||activeFilters||pref.scope!=='all'?()=>{setQuery('');setPref(p=>({...defaults,selected:p.selected}));}:undefined} filters={<>
   <select aria-label="筛选业务状态" value={pref.status} onChange={e=>setPref(p=>({...p,status:e.target.value}))}><option value="">全部状态</option>{statesFor(type).map(v=><option key={v}>{v}</option>)}</select>
   <DirectoryPicker label="筛选绑定成员" placeholder="全部成员" multiple={false} members={directory} value={pref.member_id?[pref.member_id]:[]} onChange={ids=>setPref(p=>({...p,member_id:ids[0]??''}))} renderAvatar={m=><Avatar name={m.name} src={avatarUrl('member',m.id,0)} size="tiny"/>}/>

   <select aria-label="筛选开启关闭" value={pref.closed} onChange={e=>setPref(p=>({...p,closed:e.target.value as Preference['closed']}))}><option value="all">全部档案</option><option value="open">开启中</option><option value="closed">已关闭</option></select><PageError error={directoryError} retry={()=>setDirectoryRetry(n=>n+1)}/>
  </>}/>
  <PageError error={error} retry={()=>void load()}/>
  <div className="entity-list">{items.map(a=><ArchiveRow key={a.id} selected={pref.selected===a.id} onClick={()=>choose(a.id,a.search_match)} label={`查看${a.name}`} avatar={<Avatar name={a.name} type={a.type} src={avatarUrl('archive',a.id,a.version)}/>} name={<Highlight text={a.name} query={pref.query}/>} unread={!!a.unread_count} state={<span className={'state-badge small '+(isWorkState(a.type,a.status)?'work ':'')+(a.closed?'closed':'')}>{a.status}</span>} status={a.status} binding={a.members.length?a.members.map(m=><span className="member-chip" key={m.id}><Avatar name={m.name} src={avatarUrl('member',m.id,0)} size="micro"/>{m.name}{m.frozen&&<small>已冻结</small>}</span>):null} tags={<TagSummary tags={a.tag_summary?.tags??[]} total={a.tag_summary?.total??0}/>} draft={draftIds.includes(a.id)} excerpt={a.search_match?<><small>观察命中 · </small><Highlight text={a.search_match.excerpt} query={pref.query}/></>:a.latest_observation??'还没有观察记录'} footer={<><span>{a.observation_count} 条观察</span><time>{date(a.updated_at)}</time></>}/>)}</div>
  {loading?<p className="archive-list-message" role="status">正在读取档案…</p>:error?null:!items.length?<div className="archive-list-message"><h2>{query||activeFilters||pref.scope!=='all'?'没有符合条件的档案':'从第一个档案开始'}</h2><p>{query?'试试其他关键词，或清除筛选。':`把值得关注的${label}留在这里，慢慢积累观察。`}</p></div>:cursor&&<button className="button archive-load" onClick={()=>void load(cursor)}>加载更多档案</button>}
 </>} detail={pref.selected?<ArchiveDetail onNextUnread={onNextUnread} expanded={expanded} onExpand={detailOnly?undefined:()=>setExpanded(v=>!v)} focus={focus} actor={actor} onChanged={()=>setRevision(n=>n+1)} key={pref.selected} id={pref.selected} revision={revision} onLoaded={setSelected} onBack={onClose??(detailOnly?undefined:()=>choose(null))} onEdit={()=>{if(selected){setEditTab('profile');setDialog(selected);}}} onState={()=>selected&&setStateDialog(selected)} notice={notice}/>:<aside className="selection-rest" aria-hidden="true"><div className="rest-characters"><Avatar type={type} size="large"/></div><span>打开一个档案，继续观察。</span></aside>}/>

  {dialog&&<Modal title={dialog==='create'?`新建${label}档案`:'编辑档案'} busy={busy} onClose={()=>setDialog(null)}>
   {dialog!=='create'&&<TabList id="archive-editor" value={editTab} onChange={value=>{if(!busy)setEditTab(value);}} label="编辑内容" items={[{key:'profile',label:'资料'},{key:'state',label:'状态与成员'},{key:'tags',label:'标签'},{key:'avatar',label:'头像'}]}/>}
   <div className="archive-editor-panel" id="archive-editor-timeline" role={dialog!=='create'?'tabpanel':undefined} aria-labelledby={dialog!=='create'?`archive-editor-tab-${editTab}`:undefined}>
   <div hidden={dialog!=='create'&&editTab!=='profile'}><ArchiveForm key={dialog==='create'?'create':dialog.id+dialog.version} type={type} initial={dialog==='create'?undefined:dialog} busy={busy} setBusy={setBusy} onSaved={saved} onReload={async()=>{if(dialog!=='create')await refreshEditor(dialog.id);}}/></div>
   {dialog!=='create'&&<div hidden={editTab!=='state'}><ArchiveStateForm key={dialog.id+dialog.version} archive={dialog} busy={busy} setBusy={setBusy} onSaved={saved} onReload={()=>refreshEditor(dialog.id)}/></div>}
   {dialog!=='create'&&editTab==='tags'&&<TagsSection archive={dialog} manage onChanged={()=>{void refreshEditor(dialog.id).catch(e=>setError(e.message));}}/>}
   {dialog!=='create'&&editTab==='avatar'&&<AvatarEditor actorId={actor.id} subjectType="archive" id={dialog.id} version={dialog.version} name={dialog.name} kind={dialog.type} avatarId={dialog.avatar_id} onSaved={()=>{void refreshEditor(dialog.id).catch(e=>setError(e.message));}}/>}
   </div>
  </Modal>}
  {stateDialog&&<Modal title={stateDialog.closed?'重新开启档案':'状态与成员'} busy={busy} onClose={()=>setStateDialog(null)}><ArchiveStateForm key={stateDialog.id+stateDialog.version} archive={stateDialog} busy={busy} setBusy={setBusy} onSaved={saved} onReload={async()=>{const r=await api<{archive:Archive}>('/archives/'+stateDialog.id);setStateDialog(current=>current?.id===r.archive.id&&current.version<=r.archive.version?r.archive:current);setRevision(n=>n+1);}}/></Modal>}
 </>;
}
function ArchiveDetail({actor,onChanged,id,revision,onLoaded,onBack,onEdit,onState,notice,focus,expanded,onExpand,onNextUnread}:{focus?:ObservationFocus;actor:Member;onChanged:()=>void;id:string;revision:number;onLoaded:(a:Archive)=>void;onBack?:()=>void;onEdit:()=>void;onState:()=>void;notice:string;expanded:boolean;onExpand?:()=>void;onNextUnread?:()=>void}){
 const[archive,setArchive]=useState<Archive|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[copy,setCopy]=useState(''),scroll=useRef<HTMLDivElement>(null);
 const positionKey=`cts:${actor.id}:${id}:reading-position`;
 useEffect(()=>{let cancelled=false;setError('');api<{archive:Archive}>('/archives/'+id).then(r=>{if(!cancelled){setArchive(r.archive);onLoaded(r.archive);}}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[id,revision,retry]);
 useLayoutEffect(()=>{if(archive&&!focus&&scroll.current){try{scroll.current.scrollTop=Number(localStorage.getItem(positionKey)||0);}catch{}}},[archive?.id,positionKey]);
 async function copyContact(value:string){try{await navigator.clipboard.writeText(value);setCopy('联系方式已复制');}catch{setCopy('复制未完成，请选择联系方式文字复制');}}
 return <DetailFrame label={archive?.type==='org'?'组织档案':'人物档案'} code={id.slice(0,6).toUpperCase()} expanded={expanded} onExpand={onExpand} onClose={onBack} onNextUnread={onNextUnread} scrollRef={scroll} onScroll={e=>{try{localStorage.setItem(positionKey,String(e.currentTarget.scrollTop));}catch{}}}>
  <PageError error={error} retry={()=>setRetry(n=>n+1)}/>{!archive&&!error?<p className="archive-list-message" role="status">正在打开档案…</p>:archive&&<>
   <EntityHeader name={archive.name} state={<span className={'state-badge '+(archive.closed?'closed':isWorkState(archive.type,archive.status)?'work':'')}>{archive.status}</span>} avatar={<Avatar name={archive.name} type={archive.type} size="hero" src={avatarUrl('archive',archive.id,archive.version)}/>} actions={!archive.closed&&<button className="button quiet archive-edit-entry" onClick={onEdit}><Icon name="edit"/>编辑档案</button>} assignment={archive.members.length>0&&<div className="assignment-row"><div className="assigned-members">{archive.members.map(m=><span key={m.id} className="member-chip"><Avatar name={m.name} size="micro" src={avatarUrl('member',m.id,0)}/>{m.name}{m.frozen&&<small>已冻结</small>}</span>)}</div></div>} contacts={<>{archive.contacts.map((c,i)=><button className="contact-pill" key={i} title={c.note||`复制${c.type}`} onClick={()=>void copyContact(c.value)}><small>{c.type}</small><span>{c.value}</span><Icon name="copy" size={13}/></button>)}</>}>
    {archive.links.length>0&&<ul className="archive-links">{archive.links.map((l,i)=><li key={i}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label||l.url} ↗</a></li>)}</ul>}
    {copy&&<p className="form-notice" role="status">{copy}</p>}{notice&&<p className="form-notice" role="status">{notice}</p>}
   </EntityHeader>
   {archive.closed&&<div className="locked-notice"><Icon name="lock"/><span>只读档案，重新开启后可继续维护。</span><button className="text-button" onClick={onState}>重新开启</button></div>}
   <TagsSection archive={archive} onChanged={onChanged}/><ObservationSection focus={focus} actor={actor} archive={archive} onChanged={onChanged}/>

  </>}
 </DetailFrame>;
}

function ArchiveForm({type,initial,busy,setBusy,onSaved,onReload}:{type:Kind;initial?:Archive;busy:boolean;setBusy:(b:boolean)=>void;onSaved:(id:string,changed:boolean)=>Promise<void>;onReload:()=>Promise<void>}){
 const[name,setName]=useState(initial?.name??''),[contacts,setContacts]=useState(initial?.contacts??[]),[links,setLinks]=useState(initial?.links??[]),[error,setError]=useState(''),[requestId]=useState(()=>crypto.randomUUID()),[similar,setSimilar]=useState<Archive[]>([]),[status,setStatus]=useState('视奸观察'),[members,setMembers]=useState<BoundMember[]>([]);
 useEffect(()=>{if(initial||!name.trim()){setSimilar([]);return;}let cancelled=false;const timer=setTimeout(()=>{api<{archives:Archive[]}>('/archives?'+new URLSearchParams({type,query:name,limit:'3'})).then(r=>{if(!cancelled)setSimilar(r.archives);}).catch(()=>{});},350);return()=>{cancelled=true;clearTimeout(timer);};},[name,initial,type]);
 async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await api<{id:string;changed:boolean}>(initial?'/archives/update':'/archives/create',{...(initial?{id:initial.id,expected_version:initial.version}:{type}),name,contacts,links,...(!initial?{status,member_ids:members.map(m=>m.id)}:{}),request_id:requestId});await onSaved(r.id,r.changed);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <form className="manage-form archive-form" onSubmit={save}>
  <ProfileFields type={type} name={name} setName={setName} contacts={contacts} setContacts={setContacts} links={links} setLinks={setLinks}>{similar.length>0&&<p className="similar-archives">已有相似档案：{similar.map(a=>a.name).join('、')}。同名不同对象可以继续创建。</p>}</ProfileFields>
  {!initial&&<StateFields type={type} status={status} onStatus={s=>{setStatus(s);setMembers([]);}} members={members} onMembers={setMembers}/>}
  <PageError error={error} retry={initial?()=>void onReload().catch(e=>setError(e.message)):undefined} retryLabel="重新读取并替换表单"/><ModalActions><button className="button primary" disabled={busy||(!initial&&isWorkState(type,status)&&members.length===0)}>{busy?'正在保存…':initial?'保存资料':'创建档案'}</button></ModalActions>
 </form>;
}
