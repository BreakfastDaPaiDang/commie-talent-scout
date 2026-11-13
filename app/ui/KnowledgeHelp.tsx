import React,{useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import './knowledge-help.css';

type Side='top'|'bottom'|'left'|'right';
type Box={x:number;y:number;width:number;height:number};
type Definition={id:string;selector:string;text:string;side?:Side;width?:number;members?:boolean;match?:RegExp};
type Target=Definition&{element:HTMLElement;rect:Box;pane:Box;label:string;scopeIndex?:number};
type Placement=Box&{ax:number;ay:number;ex:number;ey:number};

const definitions:Definition[]=[
 {id:'help',selector:'.kb-help-button',text:'按钮说明已开启',side:'bottom',width:190},
 {id:'scope-main',selector:'[data-kb-help="scope-main"]',text:'已形成共识，当前采用的正式内容',side:'bottom',width:138},
 {id:'scope-public',selector:'[data-kb-help="scope-public"]',text:'已经提交，供成员讨论和审核的候选内容',side:'bottom',width:138},
 {id:'scope-drafts',selector:'[data-kb-help="scope-drafts"]',text:'尚未提交，仅自己可见的个人内容',side:'bottom',width:138},
 {id:'search',selector:'.kb-search',text:'按关键词查找条目',side:'top'},
 {id:'new-entry',selector:'[data-kb-help="new-entry"]',text:'写一篇新草稿',side:'top'},
 {id:'view',selector:'.kb-view-switch',text:'切换简洁与完整操作',side:'bottom'},
 {id:'share',selector:'.kb-detail-toolbar .share-link',text:'复制当前文档链接',side:'bottom'},
 {id:'branch',selector:'.kb-branch-box select',text:'切换当前查看的分支',side:'bottom'},
 {id:'back',selector:'.kb-mobile-back',text:'返回条目列表',side:'bottom'},
 {id:'category-add',selector:'.kb-category-add',text:'新建分类',side:'right'},
 {id:'category',selector:'.kb-categories button[aria-label^="分类："]',text:'点击筛选；右键或长按查看分类解释与留言',side:'bottom',width:190},
 {id:'content',selector:'[data-kb-help="tab-content"]',text:'阅读当前文档正文',side:'bottom'},
 {id:'issues',selector:'[data-kb-help="tab-issues"], [data-kb-help="issues"]',text:'提出问题与修改建议',side:'bottom'},
 {id:'branches',selector:'[data-kb-help="tab-branches"]',text:'查看分支图、修改对比与合并情况',side:'bottom'},
 {id:'history',selector:'[data-kb-help="tab-history"], [data-kb-help="history"]',text:'查看过去的修改',side:'bottom'},
 {id:'edit',selector:'[data-kb-help="edit"]',text:'在分支中修改正文',side:'bottom'},
 {id:'remove',selector:'[data-kb-help="remove"]',text:'从当前分支移除这篇文档',side:'top'},
 {id:'submit',selector:'.kb-review-bar > button',match:/^提交到审核$/,text:'核对这篇草稿，再公开提交审核',side:'top'},
 {id:'approve',selector:'.kb-review-bar > button',match:/点赞/,text:'同意当前版本；三名正式成员同意且无冲突或并行候选时合入主分支',side:'top',width:250},
 {id:'review',selector:'.kb-review-progress button',text:'查看同意人数与尚未合入的原因',side:'top'},
 {id:'quote',selector:'.kb-article .kb-body .kb-text',text:'选中文字，可添加批注',side:'bottom',members:true},
 {id:'annotation',selector:'.kb-annotation',text:'点击对照原文；右键或长按可回复、发起议题',side:'right',width:215,members:true},
 {id:'comment',selector:'.kb-document-comments .kb-comment-form textarea, .kb-document-comments .kb-comment-form .button.primary',text:'对整篇文档发表评论',side:'bottom'},
 {id:'category-edit',selector:'.kb-category-drawer button[aria-label="编辑分类"]',text:'编辑分类名称与解释',side:'left'},
 {id:'category-close',selector:'.kb-category-drawer button[aria-label="关闭分类侧栏"]',text:'收起分类解释与留言',side:'left'},
 {id:'category-quote',selector:'.kb-category-drawer .kb-body .kb-text',text:'选中分类解释中的文字，可添加批注',side:'left',members:true},
 {id:'branch-choice',selector:'.kb-branch-choices button',text:'切换查看这个分支的修改',side:'bottom'},
 {id:'merge-row',selector:'.kb-merge-row',text:'查看这次合并请求与同意情况',side:'bottom'},
 {id:'issue-row',selector:'.kb-issue-row',text:'阅读这个问题的讨论与结论',side:'bottom'},
 {id:'history-row',selector:'.kb-history-row',text:'阅读这一版修改，不会覆盖现行内容',side:'bottom'},
];

// Contextual actions get a caption only when their real control is visible.
// Read-only readers never see explanations of controls they do not have.
const actions:[string,RegExp,string][]=[
 ['new-branch',/^＋?\s*新建分支$/,'从主分支建立一份可独立修改的分支'],
 ['share-branch',/^共享此分支$/,'把整个私人分支开放给正式成员'],
 ['delete-branch',/^删除分支$/,'删除自己的非主分支；确认后关闭其未完成审核'],
 ['propose',/^(提交|更新)合并请求$/,'把当前分支的修改提交给成员认可'],
 ['approve-merge',/^(同意这次修改|我已同意)$/,'对这次具体修改表达同意'],
 ['accept',/^合入主分支$/,'合入达标修改；多个候选须依据会议或议题结论选择'],
 ['conflict-main',/^保留主分支版本$/,'这篇冲突文档采用主分支的内容'],
 ['conflict-branch',/^保留分支版本$/,'这篇冲突文档采用当前分支的内容'],
 ['new-issue',/^＋?\s*新议题$/,'提出需要单独讨论的问题'],
 ['conclusion',/^记录结论$/,'保存讨论结论并关闭议题'],
 ['reopen',/^重新开启$/,'让已关闭的议题重新进入讨论'],
 ['issue-back',/^← 全部议题$/,'返回议题列表'],
 ['reply',/^回复$/,'在这条评论下继续讨论'],
 ['discussion-send',/^发送$/,'发布这条讨论或回复'],
 ['more',/^(加载更多|更早的记录|更多留言)/,'继续读取尚未显示的内容'],
 ['retry',/^重试$/,'重新读取加载失败的内容'],
];
for(const [id,match,text] of actions)definitions.push({id,selector:'button',match,text,side:'bottom'});

const right=(b:Box)=>b.x+b.width,bottom=(b:Box)=>b.y+b.height;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const area=(a:Box,b:Box)=>Math.max(0,Math.min(right(a),right(b))-Math.max(a.x,b.x))*Math.max(0,Math.min(bottom(a),bottom(b))-Math.max(a.y,b.y));
const box=(r:DOMRect):Box=>({x:r.left,y:r.top,width:r.width,height:r.height});
function visibleBox(element:HTMLElement,bounds:Box):Box|null{
 const style=getComputedStyle(element),r=box(element.getBoundingClientRect());
 if(!element.getClientRects().length||style.visibility==='hidden'||style.display==='none'||!r.width||!r.height)return null;
 let left=Math.max(r.x,bounds.x),top=Math.max(r.y,bounds.y),endX=Math.min(right(r),right(bounds)),endY=Math.min(bottom(r),bottom(bounds));
 for(let parent=element.parentElement;parent;parent=parent.parentElement){
  const css=getComputedStyle(parent),p=parent.getBoundingClientRect();
  if(/auto|scroll|hidden|clip/.test(css.overflowX)){left=Math.max(left,p.left);endX=Math.min(endX,p.right);}
  if(/auto|scroll|hidden|clip/.test(css.overflowY)){top=Math.max(top,p.top);endY=Math.min(endY,p.bottom);}
 }
 if(endX-left<12||endY-top<12)return null;
 const hit=document.elementFromPoint((left+endX)/2,(top+endY)/2);
 if(hit&&!element.contains(hit)&&!hit.contains(element)&&!hit.closest('.kb-help-overlay'))return null;
 return {x:left,y:top,width:endX-left,height:endY-top};
}
function connector(rect:Box,label:Box){
 const cx=label.x+label.width/2,cy=label.y+label.height/2;
 if(bottom(label)<=rect.y)return {ax:clamp(cx,rect.x+4,right(rect)-4),ay:rect.y,ex:clamp(rect.x+rect.width/2,label.x+6,right(label)-6),ey:bottom(label)};
 if(label.y>=bottom(rect))return {ax:clamp(cx,rect.x+4,right(rect)-4),ay:bottom(rect),ex:clamp(rect.x+rect.width/2,label.x+6,right(label)-6),ey:label.y};
 if(right(label)<=rect.x)return {ax:rect.x,ay:clamp(cy,rect.y+4,bottom(rect)-4),ex:right(label),ey:clamp(rect.y+rect.height/2,label.y+6,bottom(label)-6)};
 return {ax:right(rect),ay:clamp(cy,rect.y+4,bottom(rect)-4),ex:label.x,ey:clamp(rect.y+rect.height/2,label.y+6,bottom(label)-6)};
}

function place(target:Target,width:number,height:number,bounds:Box,occupied:Box[],controls:Box[]):Placement{
 const pane=target.pane,minX=Math.max(bounds.x,pane.x+8),maxX=Math.max(minX,Math.min(right(bounds),right(pane)-8)-width),minY=bounds.y,maxY=Math.max(minY,bottom(bounds)-height);
 const r=target.rect,cx=r.x+r.width/2,cy=r.y+r.height/2,gap=14;
 const positions:Record<Side,{x:number;y:number}>={top:{x:cx-width/2,y:r.y-gap-height},bottom:{x:cx-width/2,y:bottom(r)+gap},left:{x:r.x-gap-width,y:cy-height/2},right:{x:right(r)+gap,y:cy-height/2}};
 const preferred=target.scopeIndex===undefined?positions[target.side??'bottom']:{x:minX+target.scopeIndex*(width+8),y:bottom(r)+14};
 if(target.scopeIndex!==undefined){const b={x:clamp(preferred.x,minX,maxX),y:clamp(preferred.y,minY,maxY),width,height};return {...b,...connector(r,b)};}
 const candidates=[preferred,...Object.values(positions)];
 for(let y=minY;y<=maxY;y+=16)for(let x=minX;x<=maxX;x+=24)candidates.push({x,y});
 let best:Placement|undefined,bestScore=Infinity;
 for(const candidate of candidates){
  const b={x:clamp(candidate.x,minX,maxX),y:clamp(candidate.y,minY,maxY),width,height},line=connector(r,b);
  const overlaps=occupied.reduce((n,p)=>n+area({x:b.x-5,y:b.y-5,width:width+10,height:height+10},p),0);
  const cover=controls.reduce((n,p)=>n+area(b,p),0),own=area(b,r);
  let crosses=0;
  for(let step=1;step<10;step++){const x=line.ax+(line.ex-line.ax)*step/10,y=line.ay+(line.ey-line.ay)*step/10;if(occupied.some(p=>x>p.x&&x<right(p)&&y>p.y&&y<bottom(p)))crosses++;}
  const distance=Math.hypot(line.ax-line.ex,line.ay-line.ey);
  const score=overlaps*100000+own*10000+cover*30+crosses*10+Math.hypot(b.x-preferred.x,b.y-preferred.y)*2+distance+Math.max(0,distance-150)*20;
  if(score<bestScore){bestScore=score;best={...b,...line};}
 }
 return best!;
}

export function KnowledgeHelpButton({onClick,list=false,active=false}:{onClick:()=>void;list?:boolean;active?:boolean}){
 return <button type="button" className={'kb-help-button'+(list?' kb-list-help':'')} aria-label="知识库教程" title="按钮说明" aria-haspopup="dialog" aria-expanded={active} onClick={onClick}><span aria-hidden="true">?</span></button>;
}

export function KnowledgeHelp({root,writable,close}:{root:RefObject<HTMLElement|null>;writable:boolean;close:()=>void}){
 const layer=useRef<HTMLDivElement>(null),dismiss=useRef<HTMLButtonElement>(null),captions=useRef(new Map<string,HTMLElement>()),onClose=useRef(close);onClose.current=close;
 const [scene,setScene]=useState<{targets:Target[];bounds:Box;controls:Box[]}>({targets:[],bounds:{x:8,y:80,width:1,height:1},controls:[]}),[positions,setPositions]=useState<Record<string,Placement>>({});
 useLayoutEffect(()=>{
  const workspace=root.current;if(!workspace)return;
  const previous=document.activeElement;let frame=0;
  const measure=()=>{
   frame=0;
   const viewport=window.visualViewport,left=viewport?.offsetLeft??0,top=Math.max(workspace.getBoundingClientRect().top,viewport?.offsetTop??0);
   const bounds={x:left+8,y:top+8,width:(viewport?.width??innerWidth)-16,height:Math.max(1,(viewport?.offsetTop??0)+(viewport?.height??innerHeight)-top-16)};
   const targets:Target[]=[],used=new Set<HTMLElement>();
   for(const definition of definitions){
    if(definition.members&&!writable)continue;
    for(const element of workspace.querySelectorAll<HTMLElement>(definition.selector)){
     if(definition.id==='discussion-send'&&element.closest('.kb-document-comments'))continue;
     if(used.has(element)||definition.match&&!definition.match.test(element.textContent?.trim()??''))continue;
     const rect=visibleBox(element,bounds);if(!rect)continue;
     const pane=box((element.closest('.kb-category-drawer,.kb-list-pane,.kb-detail-pane')??workspace).getBoundingClientRect());
     const text=definition.id==='category'?(writable?'点击筛选；右键或长按编辑分类与解释':'点击筛选；右键或长按查看分类解释'):definition.text;
     const scopeIndex=['scope-main','scope-public','scope-drafts'].indexOf(definition.id);
     targets.push({...definition,text,element,rect,pane,label:element.getAttribute('aria-label')??element.textContent?.trim()??'',...(scopeIndex>=0?{scopeIndex}:{})});used.add(element);break;
    }
   }
   const controls=[...workspace.querySelectorAll<HTMLElement>('button,input,select,textarea')].filter(e=>!e.matches('.kb-entry,.kb-history-row,.kb-issue-row,.kb-merge-row')).map(e=>visibleBox(e,bounds)).filter((b):b is Box=>!!b);
   setScene({targets,bounds,controls});
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const mutations=new MutationObserver(schedule),resize=new ResizeObserver(schedule);
  mutations.observe(workspace,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden']});
  resize.observe(workspace);for(const element of workspace.querySelectorAll('.kb-list-pane,.kb-detail-scroll'))resize.observe(element);
  window.addEventListener('resize',schedule);document.addEventListener('scroll',schedule,true);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);document.fonts?.addEventListener('loadingdone',schedule);
  const pointer=(event:Event)=>{if(!layer.current?.contains(event.target as Node))event.stopPropagation();};
  const click=(event:Event)=>{if(layer.current?.contains(event.target as Node))return;event.preventDefault();event.stopPropagation();onClose.current();};
  const key=(event:KeyboardEvent)=>{
   if(event.isComposing)return;
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose.current();}
   else if(event.key==='Tab'){event.preventDefault();event.stopPropagation();dismiss.current?.focus({preventScroll:true});}
  };
  document.addEventListener('pointerdown',pointer,true);document.addEventListener('click',click,true);document.addEventListener('contextmenu',click,true);document.addEventListener('keydown',key,true);
  measure();
  return()=>{
   cancelAnimationFrame(frame);mutations.disconnect();resize.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);document.fonts?.removeEventListener('loadingdone',schedule);
   document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('click',click,true);document.removeEventListener('contextmenu',click,true);document.removeEventListener('keydown',key,true);
   if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});
  };
 },[root,writable]);
 useLayoutEffect(()=>{
  const placed:Record<string,Placement>={},occupied:Box[]=[];
  for(const target of scene.targets){
   const element=captions.current.get(target.id);if(!element)continue;
   const rect=element.getBoundingClientRect(),position=place(target,rect.width,rect.height,scene.bounds,occupied,scene.controls);
   placed[target.id]=position;occupied.push(position);
  }
  setPositions(placed);
 },[scene]);
 useLayoutEffect(()=>{if(document.activeElement===layer.current||!layer.current?.contains(document.activeElement))(dismiss.current??layer.current)?.focus({preventScroll:true});},[positions]);
 return createPortal(<div className="kb-help-overlay" ref={layer} tabIndex={-1} role="dialog" aria-modal="true" aria-label="知识库按钮说明">
  <svg className="kb-help-lines" aria-hidden="true">{scene.targets.map(target=>{const p=positions[target.id];return p?<g key={target.id} data-help-line={target.id}><path d={`M${p.ax} ${p.ay} L${p.ex} ${p.ey}`}/><circle cx={p.ax} cy={p.ay} r="3"/></g>:null;})}</svg>
  {scene.targets.map(target=>{
   const p=positions[target.id],narrow=scene.bounds.width<700,maxWidth=Math.min(target.width??210,target.pane.width-24,narrow?180:250),width=target.scopeIndex===undefined?(target.width?maxWidth:'max-content'):Math.min(138,(target.pane.width-40)/3);
   const style={left:p?.x??scene.bounds.x,top:p?.y??scene.bounds.y,width,maxWidth,visibility:p?'visible' as const:'hidden' as const};
   return target.id==='help'?<button type="button" ref={el=>{dismiss.current=el;if(el)captions.current.set(target.id,el);else captions.current.delete(target.id);}} key={target.id} className="kb-help-caption kb-help-dismiss" data-help-id={target.id} style={style} aria-label="关闭按钮说明" onClick={close}><strong>按钮说明已开启</strong><small>点击空白处或按 Esc 退出</small></button>:<div key={target.id} ref={el=>{if(el)captions.current.set(target.id,el);else captions.current.delete(target.id);}} className="kb-help-caption" data-help-id={target.id} data-anchor-x={target.rect.x} data-anchor-y={target.rect.y} style={style}><span className="kb-help-control-name">{target.label}：</span>{target.text}</div>;
  })}
 </div>,document.body);
}
