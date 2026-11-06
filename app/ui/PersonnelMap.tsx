import React,{useEffect,useMemo,useRef,useState} from 'react';
import {isFlowLink,rankCellId,rankForPerson,rankForStatus} from '../shared/personnel-ranks';
import {archiveStateLabel} from '../rules/archive-states';
import {useUrlView} from './use-url-view';
import {readPersonnelView,writePersonnelView} from '../shared/personnel-view';
import {personnelAttention,reception,receptionLabels} from '../shared/personnel-signals';
import {resourceStatuses,type InternalResource} from '../shared/internal-resources';
import type {MapArchive,MapCell,MapLink,PersonnelMap as Data} from '../shared/personnel-map';
import {resourceUsages} from '../shared/archive-resources';
import './personnel-map.css';

type Props={urlState?:boolean;onTransfer?:(id:string)=>void;data:Data;loading?:boolean;query:string;onQuery:(v:string)=>void;onDays:(v:number)=>void;onRefresh:()=>void;onOpen:(id:string)=>void;onEdit:(id:string)=>void;onResources?:()=>void;onEditResource?:(id:string)=>void};
const attention=(p:MapArchive,inventory:InternalResource[]=[])=>personnelAttention(p,Date.now(),inventory).length>0;
const readExtras=(p:URLSearchParams)=>({empty:p.get('p_empty')!=='0'});
const writeExtras=(p:URLSearchParams,v:ReturnType<typeof readExtras>)=>{p.set('p_empty',v.empty?'1':'0');p.delete('p_shared');};

export function PersonnelMap({data,loading=false,urlState=false,onTransfer,query,onQuery,onDays,onRefresh,onOpen,onEdit,onResources,onEditResource}:Props){
 const [view,setView]=useUrlView('p_view',readPersonnelView,writePersonnelView,urlState),{selectedLink,work}=view;
 const [extra,setExtra]=useUrlView('p_extras',readExtras,writeExtras,urlState);
 const [count,setCount]=useState(30),[workCount,setWorkCount]=useState(20),[historyCount,setHistoryCount]=useState(30);
 const [mobileRank,setMobileRank]=useState(()=>data.layers.find(l=>l.attention>0)?.id??data.layers[0]?.id??'');
 const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
 const detailRef=useRef<HTMLElement>(null),workRef=useRef<HTMLDetailsElement>(null),opener=useRef<HTMLButtonElement|null>(null);
 const byId=useMemo(()=>new Map([...data.archives,...(data.history_archives??[])].map(a=>[a.id,a])),[data]);
 const allCells=useMemo(()=>new Map(data.layers.flatMap(l=>l.cells).map(c=>[c.id,c])),[data]);
 const selected=rankCellId(view.selected),selectedCell=allCells.get(selected??'');
 const edge=data.links.find(l=>l.id===selectedLink),selectedResource=data.internal_resources.find(r=>r.id===selectedCell?.resource_id);
 const desiredStage=rankForStatus(view.stage)??view.stage,stage=data.layers.some(l=>l.id===desiredStage)?desiredStage:'';
 const layers=data.layers.filter(l=>!stage||l.id===stage);
 const people=selectedCell?[...new Set([...selectedCell.people,...selectedCell.planned])]:edge?edge.people:[];
 const workPeople=data.archives.filter(p=>(!stage||rankForPerson(p)===stage)&&(work==='all'||work==='attention'&&attention(p,data.internal_resources)||work==='planned'&&reception(p)==='planned'||work==='unarranged'&&reception(p)==='unarranged'||work==='placed'&&reception(p)==='placed'));
 const attentionCount=data.archives.filter(a=>attention(a,data.internal_resources)).length;
 const sameRank=(e:MapLink)=>allCells.get(e.from)?.stage===allCells.get(e.to)?.stage;
 const detailLinks=data.links.filter(e=>selectedCell?e.from===selectedCell.id||e.to===selectedCell.id:e.id===edge?.id);
 const linkTitle=(e:MapLink)=>e.kind==='transfer'?`${sameRank(e)?'同级状态变化':'审核／身份变化'} · ${e.people.length} 人`:e.kind==='shared'?`共同归属 · ${e.people.length} 人`:e.kind==='organization_contact'?`组织联系 · ${e.people.length} 人`:`${sameRank(e)?'同级资源调动':'实际调动'} · ${e.people.length} 人`;
 function chooseLink(id:string){setView(v=>({...v,selected:null,selectedLink:id}),true);setCount(30);}
 function openCell(c:MapCell,button?:HTMLButtonElement){if(button)opener.current=button;setView(v=>({...v,selected:c.id,selectedLink:null}),true);setCount(30);}
 function closeDetail(){setView(v=>({...v,selected:null,selectedLink:null}),true);opener.current?.focus();}
 function openWork(rank=stage,filter='attention'){setView(v=>({...v,stage:rank,work:filter}));setWorkCount(20);if(workRef.current){workRef.current.open=true;workRef.current.scrollIntoView({behavior:'smooth',block:'start'});}}
 useEffect(()=>{if(selectedCell||edge){detailRef.current?.focus({preventScroll:true});detailRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'});}},[selected,selectedLink]);
 async function copy(){try{await navigator.clipboard.writeText(window.location.href);setCopied(true);setCopyError(false);setTimeout(()=>setCopied(false),2000);}catch{setCopyError(true);}}
 return <main className="pm-page">
  <header className="pm-head">
   <div><p className="pm-kicker">统计 / 人员与资源</p><h1>人员流向</h1><p className="pm-subtitle">看清人员在哪一层，下一步由谁承接。</p></div>
   <div className="pm-head-actions">{urlState&&<button className="button quiet" onClick={copy}>{copied?'已复制':'分享视图'}</button>}<button className="button quiet" onClick={onRefresh} disabled={loading}>刷新</button>{onResources&&<button className="button primary" onClick={onResources}>管理社内资源</button>}</div>
  </header>
  <section className="pm-overview" aria-label="当前范围概况">
   <div><span>当前人员</span><strong>{data.archives.length}<small>人</small></strong></div>
   <button onClick={()=>openWork('')}><span>需要跟进 <span aria-hidden="true">↗</span></span><strong>{attentionCount}<small>人</small></strong></button>
   <div><span>社内承接资源</span><strong>{data.internal_resources.filter(r=>r.status!=='archived').length}<small>项</small></strong></div>
   <div><span>社外组织</span><strong>{data.organization_total??0}<small>家</small></strong></div>
  </section>
  <div className="pm-toolbar">
   <input aria-label="搜索流向档案" placeholder="搜索人员、资源或组织" value={query} onChange={e=>onQuery(e.target.value)} maxLength={120}/>
   <select aria-label="查看层级" value={stage} onChange={e=>setView(v=>({...v,stage:e.target.value,selected:null,selectedLink:null}))}><option value="">全部等级</option>{data.layers.map(l=><option key={l.id} value={l.id}>{l.title}（{l.people} 人）</option>)}</select>
   <label className="pm-empty-toggle"><input type="checkbox" checked={extra.empty} onChange={e=>setExtra({empty:e.target.checked})}/>显示空闲资源</label>
   {loading&&<span role="status">更新中…</span>}
  </div>
  {copyError&&<p role="status" className="pm-limit">复制未完成，可以复制浏览器地址分享当前视图。</p>}
  {data.organizations_complete===false&&<p className="pm-limit" role="status">当前展示前 {data.organizations?.length} / {data.organization_total} 家组织，请搜索缩小范围。</p>}
  {(!data.complete||!data.history_complete)&&<p className="pm-limit" role="status">{!data.complete?`当前展示前 ${data.archives.length} / ${data.total_archives} 份档案，请搜索缩小范围。`:''}{!data.history_complete?'人员变化仅展示最近 2000 条记录。':''}</p>}
  <div className={'pm-workspace '+(selectedCell||edge?'with-detail':'')}>
   <section className="pm-board" aria-label="人员等级与承接资源">
    <div className="pm-lanes" style={{'--lane-count':layers.length} as React.CSSProperties}>
     {layers.map(layer=>{
      const current=data.archives.filter(p=>rankForPerson(p)===layer.id),planned=current.filter(p=>reception(p)==='planned').length;
      const cells=layer.cells.filter(c=>c.id===selected||c.people.length||c.planned.length||c.organization_ids?.length||extra.empty&&c.resource_id&&!c.historical);
      return <section className={'pm-lane '+(layer.id==='friend'?'external ':'')+(!stage&&mobileRank!==layer.id?'mobile-collapsed':'')} key={layer.id} aria-label={layer.title}>
       <header className="pm-lane-head"><div><h2>{layer.title}</h2>{!stage&&<button className="pm-lane-toggle" aria-label={(!stage&&mobileRank!==layer.id?'展开':'收起')+layer.title} aria-expanded={!!stage||mobileRank===layer.id} onClick={()=>setMobileRank(v=>v===layer.id?'':layer.id)}>{mobileRank===layer.id?'−':'＋'}</button>}<strong>{layer.people}<small>人</small></strong></div><span>{layer.resources} 项社内资源{(layer.organizations??0)>0&&` · ${layer.organizations} 家组织`}</span></header>
       <div className="pm-lane-status">{layer.attention>0?<button onClick={()=>openWork(layer.id)}>{layer.attention} 人需跟进 <span aria-hidden="true">↗</span></button>:<span>暂无待跟进事项</span>}{planned>0&&<button onClick={()=>openWork(layer.id,'planned')}>{planned} 人计划待落实</button>}</div>
       <div className="pm-lane-cells">{cells.map(c=><Container key={c.id} cell={c} resource={data.internal_resources.find(r=>r.id===c.resource_id)} inventory={data.internal_resources} selected={selected===c.id} byId={byId} onClick={button=>openCell(c,button)}/>)}{!cells.length&&<div className="pm-lane-empty">暂无人员或承接安排{onResources&&<button className="text-button" onClick={onResources}>登记承接资源 ↗</button>}</div>}</div>
      </section>;
     })}
    </div>
    <p className="pm-board-note">各等级人数已去重。同一人可参与多个容器，资源名额跨等级共享。</p>
   </section>
   {(selectedCell||edge)&&<aside ref={detailRef} className="pm-detail" tabIndex={-1} aria-label="容器与流向详情" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();closeDetail();}}}>
    <header><div><small>{selectedCell?data.layers.find(l=>l.id===selectedCell.stage)?.title:`近 ${data.days} 天记录`}</small><h2>{selectedCell?.title??linkTitle(edge!)}</h2></div><button type="button" className="icon-close" aria-label="关闭流向详情" onClick={closeDetail}>×</button></header>
    {edge&&<button className="text-button pm-back" onClick={()=>{const c=allCells.get(edge.to);if(c)openCell(c);}}>← 返回目标容器</button>}
   {[{title:'跨等级流向',links:detailLinks.filter(e=>isFlowLink(e)&&!sameRank(e))},{title:'同级调动与关联',links:detailLinks.filter(sameRank)},{title:'其他已登记联系',links:detailLinks.filter(e=>!isFlowLink(e)&&!sameRank(e))}].filter(group=>group.links.length).map(group=><section key={group.title} aria-label={group.title}><h3>{group.title}</h3>{group.links.slice(0,50).map(e=><button className="pm-link-row" key={e.id} onClick={()=>chooseLink(e.id)}>{linkTitle(e)}<small><b>{data.layers.find(l=>l.id===allCells.get(e.from)?.stage)?.title}</b> · {allCells.get(e.from)?.title} {!isFlowLink(e)?'—':'→'} {data.layers.find(l=>l.id===allCells.get(e.to)?.stage)?.title} · {allCells.get(e.to)?.title}</small></button>)}</section>)}
   {selectedCell?.organization_ids&&<section className="pm-org-detail"><p>社外组织单独维护关系状态，不计入人员数和承接名额。</p><ul>{(data.organizations??[]).filter(o=>selectedCell.organization_ids?.includes(o.id)).map(o=><li key={o.id}><button className="text-button" onClick={()=>onOpen(o.id)}>{o.name}</button><small>{archiveStateLabel(o.status)} · {o.members.length?o.members.map(m=>m.name).join('、'):'联系负责人待明确'}</small>{o.current_need&&<p>{o.current_need}</p>}<button className="text-button" onClick={()=>onOpen(o.id)}>查看组织档案</button></li>)}</ul></section>}
   {selectedCell&&!selectedCell.organization_ids&&<><div className="pm-detail-counts"><span>实际关联<strong>{selectedCell.people.length} 人</strong></span><span>计划关联<strong>{selectedCell.planned.length} 人</strong></span></div>{selectedCell.key==='unplaced'&&<p className="pm-note">这些人员尚未落实到已登记的社内资源；原有外部联系不作为社内承接。</p>}{selectedCell.historical&&<p className="pm-note">已登记的历史变化经过此处，目前没有该层级的实际登记。</p>}{selectedCell.archive_id&&<button className="button" onClick={()=>onOpen(selectedCell.archive_id!)}>查看关联档案</button>}</>}
   {selectedResource&&<section className="pm-internal-detail"><h3>社内承接条件</h3><p>{selectedResource.note||'支持与承接说明尚未填写'}</p><p>{resourceStatuses[selectedResource.status]} · {selectedResource.remaining===null?'名额未设置':`各层共享当前空位 ${selectedResource.remaining} 人`}</p><p>全资源已落实 {selectedResource.used} 人 · 待落实 {selectedResource.planned} 人</p><p>{selectedResource.projected_remaining===null||selectedResource.projected_remaining===undefined?'计划后余量未知':`计划落实后剩余 ${selectedResource.projected_remaining} 人`}{!!selectedResource.overplanned&&` · 合计超额 ${selectedResource.overplanned} 人，需协调`}</p><p>负责：{selectedResource.members.length?selectedResource.members.map(m=>m.name+(m.frozen?'（不可用）':'')).join('、'):'待明确'}</p>{onEditResource&&<button className="button" onClick={()=>onEditResource(selectedResource.id)}>编辑社内资源</button>}</section>}
   {!selectedCell?.organization_ids&&<h3>{edge?'关联人员':'人员落实'}</h3>}{!people.length?!selectedCell?.organization_ids&&<p className="muted">暂无本层登记人员</p>:<ul className="pm-person-list">{people.slice(0,count).map(id=>{const p=byId.get(id);if(!p)return null;const planned=selectedCell?.planned.includes(id)&&!selectedCell.people.includes(id),age=Math.max(0,Math.floor((Date.now()-Date.parse(p.stage_since))/86400000));return <li key={id}><div><button className="text-button" onClick={()=>onOpen(id)}>{p.name}</button><small>{p.closed?'已关闭 · 历史人员':planned?'计划关联':receptionLabels[reception(p)]} · {archiveStateLabel(p.status)} · {Number.isFinite(age)?`当前阶段 ${age} 天`:'阶段起点未记录'}</small>{p.current_need&&<p>{p.current_need}</p>}{attention(p,data.internal_resources)&&<span className="pm-warning">{personnelAttention(p,Date.now(),data.internal_resources).join(' · ')}</span>}</div>{!p.closed&&<div className="pm-person-actions"><button className="text-button" onClick={()=>onEdit(id)}>编辑</button>{onTransfer&&reception(p)==='placed'&&<button className="text-button" onClick={()=>onTransfer(id)}>调动</button>}</div>}</li>;})}</ul>}{people.length>count&&<button className="text-button" onClick={()=>setCount(n=>n+30)}>加载更多人员</button>}
   {selectedCell&&!selectedCell.organization_ids&&<><h3>{selectedResource?'社内安排记录':'原有关联记录'} · {selectedCell.resources.length}</h3>{selectedCell.resources.map(({source_id,entry})=><div className="pm-resource" key={source_id+entry.id}><strong>{entry.name}</strong><small>{entry.type} · {entry.internal_resource_id?resourceUsages[entry.usage]:'原记录'}</small>{entry.note&&<p>{entry.note}</p>}<button className="text-button" onClick={()=>onEdit(source_id)}>编辑来源：{byId.get(source_id)?.name??'现有档案'}</button></div>)}{!selectedCell.resources.length&&<p className="muted">尚无人员安排记录</p>}<h3>人员工作依据</h3><p>观察 {selectedCell.sources.reduce((n,id)=>n+(byId.get(id)?.observations??0),0)} 条 · 材料 {selectedCell.sources.reduce((n,id)=>n+(byId.get(id)?.materials??0),0)} 份</p></>}

   </aside>}
  </div>
  <div className="pm-history-filter"><h2>落实与流动记录</h2><select aria-label="人员变化时间范围" value={data.days} onChange={e=>onDays(Number(e.target.value))}>{[7,30,90,365].map(d=><option key={d} value={d}>近 {d} 天</option>)}</select></div>
 <div className="pm-secondary"><details ref={workRef} className="pm-work-details"><summary>工作清单 <span>{attentionCount} 人需跟进</span></summary>  <section className="pm-work-list" aria-label="人员工作清单"><header><h2>需要落实的工作</h2><select aria-label="筛选人员工作" value={work} onChange={e=>{setView(old=>({...old,work:e.target.value}));setWorkCount(20);}}><option value="attention">需跟进</option><option value="unarranged">未安排社内承接</option><option value="planned">计划待落实</option><option value="placed">已落实承接</option><option value="all">全部人员</option></select><span>{workPeople.length} 人</span></header>{!workPeople.length?<p className="muted">当前范围暂无匹配人员</p>:<ul>{workPeople.slice(0,workCount).map(p=><li key={p.id}><div><button className="text-button" onClick={()=>onOpen(p.id)}>{p.name}</button><small>{receptionLabels[reception(p)]}{p.member_status&&` · ${p.member_status}`}</small></div><div>{personnelAttention(p,Date.now(),data.internal_resources).map(reason=><span key={reason} className="pm-warning">{reason}</span>)}</div><div className="pm-person-actions"><button className="text-button" onClick={()=>onEdit(p.id)}>安排／编辑</button>{onTransfer&&reception(p)==='placed'&&<button className="text-button" onClick={()=>onTransfer(p.id)}>调动</button>}</div></li>)}</ul>}{workPeople.length>workCount&&<button className="text-button" onClick={()=>setWorkCount(n=>n+20)}>加载更多工作</button>}</section></details> <details className="pm-history"><summary>近期人员变化 · {(data.movements??[]).length} 条</summary><p className="muted">近 {data.days} 天登记的阶段与资源变化，包含已关闭人员。</p><ul>{(data.movements??[]).slice(0,historyCount).map(m=>{const p=byId.get(m.archive_id);const names=(items:typeof m.resources)=>[...new Map(items.flatMap(r=>!r.restricted&&r.internal_resource_id&&r.usage==='active'?[[r.internal_resource_id,r.internal_resource?.name??r.name] as const]:[])).entries()];const before=names(m.before_resources),after=names(m.resources),entered=after.filter(([id])=>!before.some(([old])=>old===id)),left=before.filter(([id])=>!after.some(([next])=>next===id));return <li key={m.id}><div><button className="text-button" onClick={()=>onOpen(m.archive_id)}>{p?.name??'历史人员'}</button>{p?.closed&&<small> · 已关闭</small>}<time>{new Date(m.at).toLocaleString('zh-CN')}</time></div><p>{m.kind==='archive.state_changed'?`${m.before} → ${m.after}`:m.kind==='archive.closed'?'关闭／退出登记':m.kind==='archive.reopened'?'重新开启':m.kind==='archive.resource_transferred'?'实际调动':'资源安排调整'}{left.length>0&&` · 移出：${left.map(([,name])=>name).join('、')}`}{entered.length>0&&` · 落实：${entered.map(([,name])=>name).join('、')}`}</p>{m.resources_known===false&&<p>当时资源未记录，无法确认该次变化的资源归属。</p>}{m.reason&&<p>{m.reason}</p>}</li>;})}</ul>{!data.movements?.length&&<p>当前范围暂无已登记变化</p>}{(data.movements?.length??0)>historyCount&&<button className="text-button" onClick={()=>setHistoryCount(n=>n+30)}>加载更多变化</button>}</details></div>
 </main>;
}

function Container({cell,resource,inventory,selected,byId,onClick}:{cell:MapCell;resource?:InternalResource;inventory:InternalResource[];selected:boolean;byId:Map<string,MapArchive>;onClick:(button:HTMLButtonElement)=>void}){
 const issues=[...new Set([...cell.people,...cell.planned])].filter(id=>{const p=byId.get(id);return p&&attention(p,inventory);}).length;
 const organization=!!cell.organization_ids,unplaced=cell.key==='unplaced';
 const capacity=resource?.capacity,used=resource?.used??0;
 return <button className={'pm-container '+(selected?'selected ':'')+(unplaced?'unplaced ':'')+(organization?'organization':'')} data-cell-id={cell.id} aria-label={'查看容器：'+cell.title} aria-pressed={selected} onClick={e=>onClick(e.currentTarget)}>
  <span className="pm-container-type">{organization?'社外组织':unplaced?'待承接':resource?resource.type:'外部联系'}<span aria-hidden="true">↗</span></span>
  <strong className="pm-container-title">{cell.title}</strong>
  <span className="pm-container-count"><b>{organization?cell.organization_ids!.length:cell.people.length}</b>{organization?'家组织':cell.archive_id?'关联人员':'当前人员'}{cell.planned.length>0&&<small>计划 {cell.planned.length}</small>}</span>
  {resource&&<span className="pm-container-capacity">{capacity!==null&&capacity!==undefined&&<span className="pm-capacity-track"><i style={{width:`${capacity>0?Math.min(100,used/capacity*100):used?100:0}%`}}/></span>}<span>{resource.status!=='accepting'?'暂停新增承接':resource.remaining===null?'名额未设置':`共享空位 ${resource.remaining} 人`}{capacity!==null&&capacity!==undefined&&<small>总名额 {capacity}</small>}</span></span>}
  {issues>0&&<span className="pm-warning">{issues} 人需跟进</span>}
  {organization&&<span className="pm-container-caption">查看组织与联系状态</span>}
  {unplaced&&<span className="pm-container-caption">查看人员，落实承接去向</span>}
 </button>;
}
