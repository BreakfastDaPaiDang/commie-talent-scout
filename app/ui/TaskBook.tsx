import React, {type ReactNode} from 'react';
import {Icon} from './icons';
import './task-book.css';

export type TaskStage = 'failed' | 'cancelled' | 'ready' | 'active' | 'waiting' | 'closed';
export const taskStageLabels: Record<TaskStage,string> = {failed:'未完成关闭',cancelled:'已取消',ready:'待提交',active:'进行中',waiting:'待接取',closed:'已完成'};
export const taskStagePriority: Record<TaskStage,number> = {failed:0,cancelled:0,ready:1,active:2,waiting:3,closed:4};
export function RelatedTasksFrame({history,onHistory,count,children}:{history:boolean;onHistory:(value:boolean)=>void;count?:number;children:ReactNode}){
 return <section className="related-tasks" aria-label="关联任务"><header><h3>{history?'已关闭任务':'关联任务'}{!history&&count!==undefined&&<small>{count} 项开启</small>}</h3><button className="text-button" onClick={()=>onHistory(!history)}>{history?'返回开启任务':'查看已关闭任务'}</button></header>{children}</section>;
}
export function DetailActions({children}:{children:ReactNode}){return <div className="task-scene-actions">{children}</div>;}
export function TaskMark({stage}: {stage:TaskStage}) {
 return <span className={`task-mark task-mark-${stage}`} aria-hidden="true">{stage==='closed'?'✓':stage==='ready'||stage==='active'?'?':'!'}</span>;
}
export function TaskBookLayout({left,detail,selected}: {left:ReactNode;detail:ReactNode;selected:boolean}) {
 return <div className={`task-workspace-grid ${selected?'has-selection':''}`}><div className="task-book-left">{left}</div>{detail}</div>;
}
export function TaskRecommendationCard({title,kind,subject,deadline,purpose,portrait,onSelect,onRefresh}: {title?:string;kind?:string;subject?:string;deadline?:string;purpose?:string;portrait?:ReactNode;onSelect?:()=>void;onRefresh?:()=>void}) {
 return <section className="task-recommendation"><header><span className="task-star" aria-hidden="true">★</span><h2>推荐任务 <small>（测试版）</small></h2>{onRefresh&&<button className="text-button" onClick={onRefresh}>换一换 <Icon name="history" size={15}/></button>}</header>{title?<div className="task-recommendation-body"><div className="task-recommendation-portrait">{portrait??<TaskMark stage="waiting"/>}</div><div className="task-recommendation-copy"><span className="task-kind">{kind}</span><h3>{title}</h3><small>{subject}</small><time>{deadline}</time></div><div className="task-recommendation-note"><p>{purpose}</p><button className="button primary" onClick={onSelect}>查看详情</button></div></div>:<p className="task-recommendation-empty">暂时没有待接取的任务，先照顾好手上的工作。</p>}</section>;
}
export function TaskLabelsField({options,value,onChange}:{options:string[];value:string;onChange:(value:string)=>void}){
 const selected=value.split(/[、,，]/).map(value=>value.trim()).filter(Boolean);
 return <fieldset className="task-label-picker"><legend>任务标签</legend><div className="task-label-options">{options.map(label=><label key={label}><input type="checkbox" checked={selected.includes(label)} onChange={e=>onChange((e.target.checked?[...selected,label]:selected.filter(item=>item!==label)).join('、'))}/>{label}</label>)}</div><input aria-label="任务标签" value={value} maxLength={640} placeholder="可多选，也可输入标签，用顿号分隔" onChange={e=>onChange(e.target.value)}/></fieldset>;
}

export function TaskListRow({stage,title,kind,labels,priority,subject,owner,deadline,remaining,urgent,selected,onSelect,onDismiss,compact=false}: {compact?:boolean;stage:TaskStage;title:string;kind:string;labels?:string[];priority?:string;subject:ReactNode;owner?:ReactNode;deadline:string;remaining?:string;urgent?:boolean;selected:boolean;onSelect:()=>void;onDismiss?:()=>void}) {
 if(compact)return <div className={`task-list-row compact ${selected?'selected':''} stage-${stage}`}><button type="button" className="task-index-item" onClick={onSelect} aria-pressed={selected}><TaskMark stage={stage}/><strong>{title}</strong><span className="task-compact-owner">{owner??'尚未领取'}</span><span className="task-index-status">{taskStageLabels[stage]}</span></button></div>;
 return <div className={`task-list-row ${selected?'selected':''} stage-${stage}`}><button type="button" className="task-index-item" onClick={onSelect} aria-pressed={selected}>
  <TaskMark stage={stage}/><span className="task-row-content"><span className="task-row-title"><strong>{title}</strong>{priority&&<span className={`task-priority priority-${priority.toLowerCase()}`} aria-label={`优先级 ${priority}`}>{priority}</span>}{(labels?.length?labels:[kind]).map(label=><span className="task-kind" key={label}>{label}</span>)}</span><span className="task-row-meta"><span>{subject}</span><time className={urgent?'urgent':''}><Icon name="history" size={14}/>{deadline}{remaining&&<em>（{remaining}）</em>}</time>{owner&&<span><Icon name="people" size={14}/>{owner}</span>}</span></span><span className="task-index-status">{taskStageLabels[stage]}</span>
 </button>{onDismiss&&<div className="task-row-closure"><span>这项任务已关闭。</span><button className="text-button" onClick={onDismiss}>收起任务 <Icon name="close" size={13}/></button></div>}</div>;
}
export function TaskDetailCard({stage,title,kind,code,edit,labels,priority,metadata,purpose,delivery,result,actions,children}: {stage:TaskStage;title:string;kind:string;code:string;edit?:ReactNode;labels?:string[];priority?:string;metadata:{label:string;icon:string;value:ReactNode}[];purpose:string;delivery:string;result?:ReactNode;actions?:ReactNode;children?:ReactNode}) {
 return <article className={`task-scene stage-${stage}`}><header className="task-scene-head"><div className="task-scene-top"><span>任务 <span className="task-separator">/</span> {kind}</span><span className="task-scene-id">#{code}</span>{edit}</div><div className="task-scene-title-row"><h2>{title}</h2>{priority&&<span className={`task-priority priority-${priority.toLowerCase()}`} aria-label={`优先级 ${priority}`}>{priority}</span>}</div><div className="task-scene-status-row"><div className="task-label-list" aria-label="任务标签">{labels?.map(label=><span className="task-kind" key={label}>{label}</span>)}</div><div className={`task-scene-badge stage-${stage}`}><TaskMark stage={stage}/><span>{taskStageLabels[stage]}</span></div></div></header>
 <dl className="task-scene-meta-grid">{metadata.map(item=><div key={item.label}><dt><Icon name={item.icon} size={17}/>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
 <section className="task-scene-section"><h3><Icon name="file" size={22}/>任务目的</h3><p>{purpose}</p></section>
 <section className="task-scene-section task-scene-delivery"><h3><Icon name="check" size={22}/>交付要求</h3><p>{delivery}</p></section>{result}
 {actions&&<DetailActions>{actions}</DetailActions>}{children}
 </article>;
}

export function TaskBoardColumn({stage,title,subtitle,count,children}: {stage:TaskStage;title:string;subtitle:string;count:number;children:ReactNode}) {
 return <section className={`task-board-column stage-${stage}`} aria-label={title}><header><div className="task-board-column-title"><TaskMark stage={stage}/><div><h2>{title} <small>{count}</small></h2><p>{subtitle}</p></div></div></header><div className="task-board-column-list">{children}</div></section>;
}

export function TaskBoardCard({stage,title,subject,owner,initiator,labels,priority,deadline,overdue,result,selected,onSelect,action}: {stage:TaskStage;title:string;subject:ReactNode;owner?:ReactNode;initiator?:ReactNode;labels?:string[];priority?:string;deadline:string;overdue?:boolean;result?:string;selected?:boolean;onSelect:()=>void;action?:ReactNode}) {
 return <article className={`task-board-card stage-${stage} ${selected?'selected':''} ${overdue?'overdue':''}`}><button type="button" className="task-board-card-main" onClick={onSelect} aria-pressed={selected}><div className="task-board-card-head"><TaskMark stage={stage}/><h3>{title}</h3>{priority&&<span className={`task-priority priority-${priority.toLowerCase()}`}>{priority}</span>}</div><div className="task-board-card-subject">{subject}</div><div className="task-board-card-meta">{owner&&<span><Icon name="people" size={14}/>{owner}</span>}{initiator&&<span><span className="task-board-meta-label">发起</span>{initiator}</span>}<time className={overdue?'urgent':''}><Icon name="history" size={14}/>{overdue?'已逾期 · ':''}{deadline}</time></div><div className="task-board-card-foot">{labels?.map(label=><span className="task-board-label" key={label}>{label}</span>)}{result&&<span className="task-board-result">{result}</span>}</div></button>{action&&<div className="task-board-card-action">{action}</div>}</article>;
}
