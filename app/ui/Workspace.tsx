import React,{useEffect,useRef,type ReactNode,type RefObject} from 'react';
import {Icon,Mark} from './icons';

// Promoted from the approved prototype (531ab51). Both applications render these
// components; persistence, permissions and data loading belong to their adapters.
export function IconButton({name,label,...props}:{name:string;label:string}&React.ButtonHTMLAttributes<HTMLButtonElement>){
 return <button type="button" className="icon-button" aria-label={label} title={label} {...props}><Icon name={name}/></button>;
}
export function TopBar({navigation,tools,mobileTools,onHome}:{navigation:ReactNode;tools:ReactNode;mobileTools?:ReactNode;onHome:()=>void}){
 return <header className="topbar"><a className="brand" href="/" onClick={e=>{e.preventDefault();onHome();}}><Mark/><span>康米巨星<small>猎头系统</small></span></a><nav className="primary-nav" aria-label="主要导航">{navigation}</nav><div className="topbar-tools">{tools}</div>{mobileTools}</header>;
}
export function WorkspaceFrame({list,detail,selected,expanded=false,detailOnly=false}:{list:ReactNode;detail:ReactNode;selected:boolean;expanded?:boolean;detailOnly?:boolean}){
 return <div className={`workspace-layout ${selected?'has-detail':''} ${expanded?'expanded-detail':''} ${detailOnly?'detail-only':''}`}><div className="workspace"><main className="main-panel">{list}</main>{detail}</div></div>;
}
export function ArchiveHead({label,count,query,onQuery,onCreate,searchRef}:{label:string;count:string;query:string;onQuery:(value:string)=>void;onCreate:()=>void;searchRef?:RefObject<HTMLInputElement|null>}){
 const localRef=useRef<HTMLInputElement>(null),inputRef=searchRef??localRef;
 useEffect(()=>{const key=(e:KeyboardEvent)=>{const target=e.target as HTMLElement;if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(target.tagName)&&!target.isContentEditable&&!document.querySelector('dialog[open]')){e.preventDefault();inputRef.current?.focus();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[inputRef]);
 return <header className="page-head archive-head"><div><h1>{label}<span className="page-count">{count}</span></h1></div><div className="search-field"><Icon name="search"/><input ref={inputRef} aria-label="搜索档案" placeholder="搜索档案、观察" value={query} maxLength={200} onChange={e=>onQuery(e.target.value)}/>{query?<IconButton name="close" label="清空搜索" onClick={()=>onQuery('')}/>:<kbd>/</kbd>}</div><button className="button primary" onClick={onCreate}><Icon name="plus"/>新建</button></header>;
}
export function ScopeToolbar({scope,onScope,counts,filtersOpen,onFilters,activeFilters,filters,onReset}:{scope:string;onScope:(value:string)=>void;counts?:Record<string,number>;filtersOpen:boolean;onFilters:()=>void;activeFilters:boolean;filters:ReactNode;onReset?:()=>void}){
 return <section className="list-toolbar"><div className="scope-filter-row"><div className="scope-tabs" aria-label="档案范围">{[['all','全部'],['mine','我负责'],['unread','有未读']].map(([key,label])=><button key={key} aria-pressed={scope===key} className={scope===key?'active':''} onClick={()=>onScope(key)}>{label}{counts&&<small>{counts[key]}</small>}</button>)}</div><button className={`filter-toggle ${activeFilters?'has-filters':''}`} aria-expanded={filtersOpen} onClick={onFilters}><Icon name="filter" size={18}/>筛选{activeFilters&&<span className="unread-dot"/>}</button></div>{filtersOpen&&<div className="filter-row">{filters}{onReset&&<button className="text-button" onClick={onReset}>清除条件</button>}</div>}</section>;
}
export function CompletionStamp({status}:{status?:string}){
 if(status!=='已入伙'&&status!=='已弃用')return null;
 return <span className={'completion-stamp '+(status==='已入伙'?'joined':'discarded')} role="img" aria-label={status} title={status}><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d={status==='已入伙'?'M10 33 25 48 55 14':'M14 14 50 50 M50 14 14 50'} stroke="currentColor" strokeWidth="7" strokeLinecap="square" strokeLinejoin="miter"/></svg></span>;
}
export function ArchiveRow({avatar,name,state,status,binding,excerpt,footer,tags,draft,unread,selected,onClick,label}:{avatar:ReactNode;name:ReactNode;state:ReactNode;status?:string;binding:ReactNode;excerpt:ReactNode;footer:ReactNode;tags?:ReactNode;draft?:boolean;unread?:boolean;selected:boolean;onClick:()=>void;label?:string}){
 const completed=status==='已入伙'||status==='已弃用';
 return <button className={`entity-row ${selected?'selected':''} ${completed?'completed':''} ${unread?'has-updates':''}`} onClick={onClick} aria-label={label}>{avatar}<div className="row-content"><div className="row-heading"><div className="row-title"><h2>{name}</h2></div><div className="row-meta">{state}{draft&&<span className="draft-tag">草稿</span>}</div>{binding&&<div className="row-binding">{binding}</div>}</div>{tags}<p className="record-excerpt">{excerpt}</p><div className="row-foot">{footer}</div></div><CompletionStamp status={status}/>{unread&&<span className="row-unread">有更新</span>}</button>;
}
export function DetailFrame({label,code,expanded,onExpand,onClose,onNextUnread,scrollRef,onScroll,children}:{label:string;code:string;expanded?:boolean;onExpand?:()=>void;onClose?:()=>void;onNextUnread?:()=>void;scrollRef?:RefObject<HTMLDivElement|null>;onScroll?:React.UIEventHandler<HTMLDivElement>;children:ReactNode}){
 return <aside className="detail-panel" aria-label={label+'详情'}><div className="detail-top"><span>{label}<span className="detail-number"> / {code}</span></span><div>{onNextUnread&&<button className="next-unread" onClick={onNextUnread}>下一处未读<Icon name="arrow" size={15}/></button>}{onExpand&&<IconButton name="expand" label={expanded?'收起阅读视图':'展开阅读视图'} onClick={onExpand}/>} {onClose&&<IconButton name="close" label="关闭档案详情" onClick={onClose}/>}</div></div><div className="detail-scroll" ref={scrollRef} onScroll={onScroll}><div className="detail-inner">{children}</div></div></aside>;
}
export function EntityHeader({name,state,avatar,actions,assignment,contacts,children}:{name:ReactNode;state:ReactNode;avatar:ReactNode;actions:ReactNode;assignment:ReactNode;contacts:ReactNode;children?:ReactNode}){
 return <header className="entity-header"><div className="entity-identity"><div className="entity-heading"><h1>{name}</h1>{state}</div>{avatar}{actions}</div>{assignment}<div className="contacts-bar">{contacts}</div>{children}</header>;
}
export function TabList({id,value,onChange,items,label='内容筛选'}:{id:string;value:string;onChange:(value:string)=>void;items:{key:string;label:string;count?:number}[];label?:string}){
 return <div className="timeline-tabs observation-toolbar" role="tablist" aria-label={label}>{items.map(({key,label,count})=><button role="tab" id={`${id}-tab-${key}`} aria-controls={`${id}-timeline`} aria-selected={value===key} aria-pressed={value===key} tabIndex={value===key?0:-1} onKeyDown={e=>{const tabs=[...e.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')],i=tabs.indexOf(e.currentTarget),n:Record<string,number>={ArrowRight:(i+1)%tabs.length,ArrowLeft:(i+tabs.length-1)%tabs.length,Home:0,End:tabs.length-1};if(n[e.key]!==undefined){e.preventDefault();tabs[n[e.key]].click();tabs[n[e.key]].focus();}}} className={value===key?'active':''} key={key} onClick={()=>onChange(key)}>{label}{!!count&&<small>{count}</small>}</button>)}</div>;
}
export function TimelineTabs({id,value,onChange,deletedCount}:{id:string;value:string;onChange:(value:string)=>void;deletedCount?:number}){
 return <TabList id={id} value={value} onChange={onChange} label="动态筛选" items={[{key:'all',label:'全部动态'},{key:'observations',label:'观察记录'},{key:'deleted',label:'已删除',count:deletedCount}]}/>;
}
export function ComposerFrame({open,onOpen,textarea,children}:{open:boolean;onOpen:()=>void;textarea:React.TextareaHTMLAttributes<HTMLTextAreaElement>;children?:ReactNode}){
 const input=useRef<HTMLTextAreaElement>(null);
 return <section className={`composer observation-composer ${open?'open':''}`} aria-label="撰写观察"><div className="composer-line"><button type="button" className="compose-launch" aria-label="开始撰写观察" onClick={()=>{onOpen();input.current?.focus();}}><Icon name="plus" size={22}/></button><textarea ref={input} aria-label="新的观察记录" rows={open?3:1} placeholder="写下新的观察…" {...textarea} onFocus={e=>{onOpen();textarea.onFocus?.(e);}}/></div>{open&&children}</section>;
}
export function ObservationFrame({id,avatar,author,time,edited,unread,onHistory,historyLabel,footer,deleted,children}:{id:string;avatar:ReactNode;author:ReactNode;time:ReactNode;edited?:ReactNode;unread?:boolean;onHistory:()=>void;historyLabel:string;footer?:ReactNode;deleted?:boolean;children:ReactNode}){
 return <article className={`observation observation-card ${deleted?'deleted':''}`} id={id}><header className="record-byline">{avatar}<strong>{author}</strong>{unread&&<span className="unread-dot"/>}<time>{time}</time>{edited&&<small>{edited}</small>}<IconButton name="history" label={historyLabel} onClick={onHistory}/></header>{children}{footer&&<footer className="record-actions">{footer}</footer>}</article>;
}
export function RecordBody({body,boundary,renderText,className=''}:{body:string;boundary?:ReactNode;renderText?:(line:string)=>ReactNode;className?:string}){
 return <div className={`record-body ${className}`}>{boundary}{body.split('\n').filter(Boolean).map((line,i)=><p key={i}>{renderText?renderText(line):line}</p>)}</div>;
}
export function UpdateRow({avatar,label,name,excerpt,time,read,selected,onClick}:{avatar:ReactNode;label:ReactNode;name:ReactNode;excerpt:ReactNode;time:ReactNode;read:boolean;selected:boolean;onClick:()=>void}){
 return <button className={`update-row ${selected?'selected':''} ${read?'read':''}`} onClick={onClick}>{avatar}<div><span className="kind-label">{label}</span><h2>{name}</h2><p>{excerpt}</p><time>{time}</time></div><Icon name={read?'check':'arrow'}/></button>;
}
export function CaughtUp({action}:{action:ReactNode}){
 return <div className="caught-up"><img src="/art/observation-pause-v3.png" alt="放下望远镜，暂歇片刻的观察员"/><h2>近况，都看过了。</h2><p>新的观察与变化，会在这里等你。</p>{action}</div>;
}
