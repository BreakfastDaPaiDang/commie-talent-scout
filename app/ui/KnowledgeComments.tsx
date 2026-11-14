import React,{useEffect,useRef,useState,type ReactNode} from 'react';
import type {KnowledgeApi,KnowledgeComment,KnowledgeIdentity,KnowledgeVersion} from '../shared/knowledge';
import {locateAnnotation} from '../shared/knowledge';
import {Avatar} from './Avatar';
import {Icon} from './icons';
import {Modal,ModalActions} from './Modal';

export type CommentTarget={branch_id?:string;document_id?:string;category_id?:string;issue_id?:string};
type Anchor={start:number;end:number;quote:string};
export function useKnowledgeComments(api:KnowledgeApi,target:CommentTarget){
 const query=new URLSearchParams(target as Record<string,string>).toString(),[comments,setComments]=useState<KnowledgeComment[]>([]),[next,setNext]=useState<number|null>(null),[revision,setRevision]=useState(0),[error,setError]=useState('');
 const current=useRef(query);current.current=query;
 useEffect(()=>{let active=true;setComments([]);setError('');api.read('/comments?'+query).then(data=>{if(active){setComments(data.comments);setNext(data.next_offset);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[api,query,revision]);
 async function more(){try{const data=await api.read('/comments?'+query+'&offset='+next);if(current.current===query){setComments(old=>[...old,...data.comments]);setNext(data.next_offset);}}catch(e){setError((e as Error).message);}}
 return {comments,next,more,error,reload:()=>setRevision(v=>v+1)};
}
export function CommentForm({api,target,onSaved,placeholder='写下评论…',label='发送',extra={},onCancel}:{api:KnowledgeApi;target:CommentTarget;onSaved:()=>void;placeholder?:string;label?:string;extra?:Record<string,unknown>;onCancel?:()=>void}){
 const [body,setBody]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <form className="kb-comment-form" onSubmit={async e=>{e.preventDefault();if(!body.trim())return;setBusy(true);setError('');try{await api.write('/comments',{...target,...extra,body});setBody('');onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
  <textarea aria-label={placeholder} placeholder={placeholder} maxLength={8000} rows={2} value={body} onChange={e=>setBody(e.target.value)} required/>
  <div className="kb-form-actions">{onCancel&&<button type="button" className="button quiet" onClick={onCancel} disabled={busy}>取消</button>}<button className="button primary" disabled={busy||!body.trim()}>{busy?'发送中…':label}</button></div>{error&&<p role="alert" className="form-error">{error}</p>}
 </form>;
}
export function CommentItem({comment,api,target,onSaved,writable}:{comment:KnowledgeComment;api:KnowledgeApi;target:CommentTarget;onSaved:()=>void;writable:boolean}){
 const [reply,setReply]=useState(false);return <div className={'kb-comment '+(comment.parent_id?'kb-reply':'')}><div className="kb-comment-meta"><strong>{comment.author_name}</strong><time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>{writable&&<button className="text-button" onClick={()=>setReply(v=>!v)}>回复</button>}</div><p>{comment.body}</p>{reply&&<CommentForm api={api} target={target} extra={{parent_id:comment.id}} placeholder={'回复 '+comment.author_name+'…'} onSaved={()=>{setReply(false);onSaved();}} onCancel={()=>setReply(false)}/>}</div>;
}
export function Discussion({api,target,writable,title='留言'}:{api:KnowledgeApi;target:CommentTarget;writable:boolean;title?:string}){
 const state=useKnowledgeComments(api,target);return <section className="kb-discussion"><h3>{title}</h3>{state.error&&<p role="alert" className="form-error">{state.error}</p>}{state.comments.map(c=><CommentItem key={c.id} comment={c} api={api} target={target} writable={writable} onSaved={state.reload}/>)}{state.next!==null&&<button className="text-button" onClick={state.more}>更多留言</button>}{!state.comments.length&&<p className="kb-muted">还没有留言</p>}{writable&&<CommentForm api={api} target={target} onSaved={state.reload}/>}</section>;
}

function sourcePosition(node:Node,offset:number){const element=(node.nodeType===Node.ELEMENT_NODE?node as Element:node.parentElement)?.closest<HTMLElement>('[data-kb-start]');if(!element)return null;const range=document.createRange();range.selectNodeContents(element);try{range.setEnd(node,offset);}catch{return null;}return Number(element.dataset.kbStart)+(range.toString().length);}
function overlaps(a:Anchor,b:Anchor){return a.start<b.end&&b.start<a.end;}
function AnnotationAvatar({id,name,identity}:{id:string;name:string;identity:KnowledgeIdentity}){
 return <Avatar name={name} src={identity.kind==='member'?'/avatars/members/'+encodeURIComponent(id):undefined} size="tiny"/>;
}
function AnnotationComposer({api,target,identity,extra,onSaved,onCancel,placeholder='针对这句话写下批注…'}:{api:KnowledgeApi;target:CommentTarget;identity:KnowledgeIdentity;extra:Record<string,unknown>;onSaved:()=>void;onCancel:()=>void;placeholder?:string}){
 const [body,setBody]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),input=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{input.current?.focus();},[]);
 return <form className="kb-annotation-form" onSubmit={async e=>{e.preventDefault();if(busy||!body.trim())return;setBusy(true);setError('');try{await api.write('/comments',{...target,...extra,body});onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
  <div className="kb-annotation-shell"><AnnotationAvatar id={identity.id} name={identity.name} identity={identity}/><textarea ref={input} aria-label={placeholder} placeholder={placeholder} maxLength={8000} rows={1} value={body} disabled={busy} required onChange={e=>{setBody(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,180)+'px';}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Escape'&&!busy){e.stopPropagation();onCancel();}else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/></div>
  <div className="kb-annotation-actions"><button type="button" aria-label="取消批注" title="取消" onClick={onCancel} disabled={busy}>×</button><button type="submit" aria-label="发布批注" title="发布批注（Ctrl+Enter）" disabled={busy||!body.trim()}><Icon name="arrow" size={18}/></button></div>{error&&<p role="alert" className="form-error">{error}</p>}
 </form>;
}
function AnnotationItem({comment,identity,api,target,writable,onSaved,active,onActivate,sourceTitle,onIssue}:{comment:KnowledgeComment;identity:KnowledgeIdentity;api:KnowledgeApi;target:CommentTarget;writable:boolean;onSaved:()=>void;active:boolean;onActivate:()=>void;sourceTitle:string;onIssue?:(id:string)=>void}){
 const [reply,setReply]=useState(false),[menu,setMenu]=useState(false),[issue,setIssue]=useState(false),container=useRef<HTMLDivElement>(null),item=useRef<HTMLDivElement>(null),menuButton=useRef<HTMLButtonElement>(null),press=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>clearTimeout(press.current),[]);
 useEffect(()=>{if(!menu)return;menuButton.current?.focus();const dismiss=(e:PointerEvent)=>{if(!container.current?.contains(e.target as Node))setMenu(false);};document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss);},[menu]);
 return <div ref={container} className={'kb-annotation-wrap'+(comment.parent_id?' kb-annotation-reply':'')}>
  <div ref={item} className="kb-annotation" role="button" tabIndex={0} aria-label={comment.author_name+'的批注：'+comment.body} aria-pressed={active} data-kb-annotation-id={comment.id} onClick={onActivate} onFocus={onActivate} onPointerDown={e=>{onActivate();if(writable&&e.pointerType==='touch')press.current=setTimeout(()=>setMenu(true),550);}} onPointerMove={()=>clearTimeout(press.current)} onPointerUp={()=>clearTimeout(press.current)} onPointerCancel={()=>clearTimeout(press.current)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onActivate();}else if(writable&&(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey)){e.preventDefault();onActivate();setMenu(true);}}} onContextMenu={e=>{if(!writable||!window.getSelection()?.isCollapsed)return;e.preventDefault();onActivate();setMenu(true);}}>
   <AnnotationAvatar id={comment.author_id} name={comment.author_name} identity={identity}/><span className="kb-annotation-text">{comment.body}</span>
  </div>
  {menu&&<div className="kb-annotation-menu" role="menu" aria-label="批注操作" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setMenu(false);item.current?.focus();}}}><button ref={menuButton} type="button" role="menuitem" onClick={()=>{setMenu(false);setReply(true);}}>回复批注</button><button type="button" role="menuitem" onClick={()=>{setMenu(false);setIssue(true);}}>发起议题</button></div>}
  {reply&&<AnnotationComposer api={api} target={target} identity={identity} extra={{parent_id:comment.id}} placeholder={'回复 '+comment.author_name+'…'} onSaved={()=>{setReply(false);onSaved();}} onCancel={()=>setReply(false)}/>}
  {issue&&<AnnotationIssue api={api} comment={comment} sourceTitle={sourceTitle} close={()=>setIssue(false)} done={id=>{setIssue(false);onIssue?.(id);}}/>}
 </div>;
}

function AnnotationIssue({api,comment,sourceTitle,close,done}:{api:KnowledgeApi;comment:KnowledgeComment;sourceTitle:string;close:()=>void;done:(id:string)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <Modal title="从批注发起议题" onClose={close} busy={busy}><form className="kb-form" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');try{const result=await api.write('/issues/from-comment',{comment_id:comment.id,title:f.get('title'),body:f.get('body')});done(result.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}><p className="kb-muted">{sourceTitle}</p><blockquote className="kb-issue-source">{comment.quote}</blockquote><label>议题标题<input name="title" defaultValue={'讨论：'+sourceTitle} required maxLength={200}/></label><label>讨论内容<textarea name="body" defaultValue={comment.body} rows={5} required maxLength={12000}/></label>{error&&<p role="alert" className="form-error">{error}</p>}<ModalActions><button className="button primary" disabled={busy}>发起议题</button></ModalActions></form></Modal>;
}

export function KnowledgeDocumentBody({api,document:doc,branchId,writable,identity,footer,categoryId,onIssue}:{api:KnowledgeApi;document:KnowledgeVersion;branchId:string;writable:boolean;identity:KnowledgeIdentity;footer?:ReactNode;categoryId?:string;onIssue?:(id:string)=>void}){
 const target={branch_id:branchId,...(categoryId?{category_id:categoryId}:{document_id:doc.document_id})},state=useKnowledgeComments(api,target),bodyRef=useRef<HTMLDivElement>(null),[selection,setSelection]=useState<(Anchor&{x:number;y:number})|null>(null),[selectionVisible,setSelectionVisible]=useState(false),[composer,setComposer]=useState<Anchor|null>(null),[activeAnchor,setActiveAnchor]=useState<Anchor|null>(null),[copyLabel,setCopyLabel]=useState('复制');
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const inspect=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(composer)return;const s=window.getSelection();if(!s||s.isCollapsed||!s.rangeCount||!bodyRef.current?.contains(s.anchorNode)||!bodyRef.current.contains(s.focusNode)){setSelection(null);return;}const range=s.getRangeAt(0),start=sourcePosition(range.startContainer,range.startOffset),end=sourcePosition(range.endContainer,range.endOffset);if(start===null||end===null||end<=start||end-start>4000){setSelection(null);return;}const quote=doc.body.slice(start,end);if(quote!==s.toString()){setSelection(null);return;}const rect=range.getBoundingClientRect();setCopyLabel('复制');setActiveAnchor(null);setSelectionVisible(true);setSelection({start,end,quote,x:Math.max(12,Math.min(window.innerWidth-170,rect.left)),y:Math.max(72,rect.top-44)});},100);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setSelection(null);setActiveAnchor(null);window.getSelection()?.removeAllRanges();}};
  const outside=(e:Event)=>{const element=e.target instanceof Element?e.target:null,inside=element&&bodyRef.current?.contains(element)&&element.closest('[data-kb-quote],[data-kb-annotation-id],.kb-annotation-form,.kb-annotation-menu'),tools=element?.closest<HTMLElement>('[data-kb-tools]')?.dataset.kbTools===doc.id;if(!inside&&!tools){setActiveAnchor(null);setSelection(null);}};
  const hide=()=>{clearTimeout(timer);setSelectionVisible(false);};document.addEventListener('selectionchange',inspect);document.addEventListener('keydown',escape);document.addEventListener('pointerdown',outside);document.addEventListener('focusin',outside);document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);return()=>{clearTimeout(timer);document.removeEventListener('selectionchange',inspect);document.removeEventListener('keydown',escape);document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);document.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide);};
 },[doc.id,doc.body,composer]);
 const annotated=state.comments.filter(c=>c.quote),positions=annotated.map(c=>({c,anchor:locateAnnotation(doc.body,c,doc.id)})),obsolete=positions.filter(p=>!p.anchor),attached=positions.filter((p):p is {c:KnowledgeComment;anchor:Anchor}=>!!p.anchor).map(p=>({...p,anchor:{...p.anchor,quote:p.c.quote!}}));
 const activeRanges=[...(activeAnchor?[activeAnchor]:[]),...(composer?[composer]:[]),...(selection?attached.filter(p=>overlaps(p.anchor,selection)).map(p=>p.anchor):[])];
 function activate(anchor:Anchor){setActiveAnchor(anchor);setSelection(null);}
 function renderText(start:number,end:number){
  const highlights=[...attached.map(p=>p.anchor),...(composer?[composer]:[])].filter(a=>a.start<end&&a.end>start),cuts=[...new Set([start,end,...highlights.flatMap(a=>[Math.max(start,a.start),Math.min(end,a.end)])])].sort((a,b)=>a-b);
  return <span data-kb-start={start} data-kb-end={end}>{cuts.slice(0,-1).map((from,i)=>{const to=cuts[i+1],anchor=highlights.find(a=>a.start<=from&&a.end>=to),text=doc.body.slice(from,to);if(!anchor)return <React.Fragment key={from}>{text}</React.Fragment>;const active=activeRanges.some(a=>a.start<=from&&a.end>=to);return <mark key={from} className={'kb-quote'+(active?' is-active':'')} data-kb-quote="" role="button" tabIndex={0} aria-label={'引用原文：'+text} aria-pressed={active} onFocus={()=>activate(anchor)} onClick={()=>{if(window.getSelection()?.isCollapsed)activate(anchor);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate(anchor);}}}>{text}</mark>;})}</span>;
 }
 function endOfSentence(anchorEnd:number){const tail=doc.body.slice(anchorEnd),prior=doc.body[anchorEnd-1];if(/[。！？.!?\n]/.test(prior??''))return anchorEnd;const match=tail.search(/[。！？.!?\n]/);return match<0?doc.body.length:anchorEnd+match+(tail[match]==='\n'?0:1);}
 const threads=new Map<number,KnowledgeComment[]>();for(const p of attached){const end=endOfSentence(p.anchor.end);threads.set(end,[...(threads.get(end)??[]),p.c]);}const composerEnd=composer?endOfSentence(composer.end):-1;
 const blocks:ReactNode[]=[];let start=0;
 for(const line of doc.body.split('\n')){
  const rawStart=start,end=start+line.length;start=end+1;if(!line.trim())continue;const heading=line.match(/^#{1,3}\s+/),contentStart=rawStart+(heading?.[0].length??0),breaks=[...new Set([end,...[...threads.keys()].filter(n=>n>=contentStart&&n<=end),...(composerEnd>=contentStart&&composerEnd<=end?[composerEnd]:[])])].sort((a,b)=>a-b);let from=contentStart;
  for(const to of breaks){
   if(to>from)blocks.push(heading?<h2 key={'h'+from}>{renderText(from,to)}</h2>:<p className="kb-text" key={'p'+from}>{renderText(from,to)}</p>);
   const comments=threads.get(to);if(comments)blocks.push(<aside className="kb-inline-thread" aria-label="句下批注" key={'a'+to}>{comments.map(c=>{const anchor=attached.find(p=>p.c.id===c.id)!.anchor;return <AnnotationItem key={c.id} comment={c} sourceTitle={doc.title} onIssue={onIssue} identity={identity} api={api} target={target} writable={writable} onSaved={state.reload} active={activeRanges.some(a=>a.start===anchor.start&&a.end===anchor.end)} onActivate={()=>activate(anchor)}/>;})}</aside>);
   if(composer&&composerEnd===to)blocks.push(<div className="kb-annotation-composer" key="composer"><AnnotationComposer api={api} target={target} identity={identity} extra={{version_id:doc.id,quote:composer.quote,start_offset:composer.start,end_offset:composer.end}} onSaved={()=>{setActiveAnchor(composer);setComposer(null);setSelection(null);state.reload();}} onCancel={()=>{setComposer(null);setSelection(null);setActiveAnchor(null);}}/></div>);from=to;
  }
 }
 return <><div className="kb-body" ref={bodyRef}>{blocks}</div>{selection&&selectionVisible&&writable&&!composer&&<div className="kb-selection-tools" data-kb-tools={doc.id} role="toolbar" aria-label="选中文字操作" style={{left:selection.x,top:selection.y}} onPointerDown={e=>e.preventDefault()}><button onClick={async()=>{try{await navigator.clipboard.writeText(selection.quote);setCopyLabel('已复制');}catch{setCopyLabel('请用系统复制');}}}>{copyLabel}</button><button onClick={()=>{setComposer(selection);setActiveAnchor(selection);setSelection(null);window.getSelection()?.removeAllRanges();}}>批注</button></div>}{footer}
 <section className="kb-document-comments"><h2>{categoryId?'分类留言':'文档评论'}</h2>{state.error&&<p className="form-error" role="alert">{state.error}</p>}{state.comments.filter(c=>!c.quote).map(c=><CommentItem key={c.id} comment={c} api={api} target={target} writable={writable} onSaved={state.reload}/>)}{!state.comments.some(c=>!c.quote)&&<p className="kb-muted">还没有评论</p>}{state.next!==null&&<button className="text-button" onClick={state.more}>加载更多评论与批注</button>}{writable&&<CommentForm api={api} target={target} onSaved={state.reload} placeholder={categoryId?'写下评论…':'写下对这篇文档的评论…'}/>}
 {obsolete.length>0&&<details className="kb-obsolete"><summary>原文已变更的批注（{obsolete.length}）</summary>{obsolete.map(({c})=><div key={c.id}><blockquote>{c.quote}</blockquote><CommentItem comment={c} api={api} target={target} writable={writable} onSaved={state.reload}/></div>)}</details>}</section></>;
}
