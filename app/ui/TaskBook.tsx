import React, {type ReactNode} from 'react';
import {Icon} from './icons';
import './task-book.css';

export type TaskStage = 'failed' | 'cancelled' | 'ready' | 'active' | 'waiting' | 'closed';
export const taskStageLabels: Record<TaskStage,string> = {failed:'未完成关闭',cancelled:'已取消',ready:'待提交',active:'进行中',waiting:'待接取',closed:'已完成'};
export const taskStagePriority: Record<TaskStage,number> = {failed:0,cancelled:0,ready:1,active:2,waiting:3,closed:4};
export function TaskMark({stage}: {stage:TaskStage}) {
 return <span className={`task-mark task-mark-${stage}`} aria-hidden="true">{stage==='closed'?'✓':stage==='ready'||stage==='active'?'?':'!'}</span>;
}
export function TaskBookLayout({left,detail,selected}: {left:ReactNode;detail:ReactNode;selected:boolean}) {
 return <div className={`task-workspace-grid ${selected?'has-selection':''}`}><div className="task-book-left">{left}</div>{detail}</div>;
}
export function TaskRecommendationCard({title,kind,subject,deadline,purpose,portrait,onSelect,onRefresh}: {title?:string;kind?:string;subject?:string;deadline?:string;purpose?:string;portrait?:ReactNode;onSelect?:()=>void;onRefresh?:()=>void}) {
 return <section className="task-recommendation"><header><span className="task-star" aria-hidden="true">★</span><h2>推荐任务 <small>（测试版）</small></h2>{onRefresh&&<button className="text-button" onClick={onRefresh}>换一换 <Icon name="history" size={15}/></button>}</header>{title?<div className="task-recommendation-body"><div className="task-recommendation-portrait">{portrait??<TaskMark stage="waiting"/>}</div><div className="task-recommendation-copy"><span className="task-kind">{kind}</span><h3>{title}</h3><small>{subject}</small><time>{deadline}</time></div><div className="task-recommendation-note"><p>{purpose}</p><button className="button primary" onClick={onSelect}>查看详情</button></div></div>:<p className="task-recommendation-empty">暂时没有待接取的任务，先照顾好手上的工作。</p>}</section>;
}
export function TaskListRow({stage,title,kind,subject,owner,deadline,remaining,urgent,selected,onSelect,onDismiss}: {stage:TaskStage;title:string;kind:string;subject:ReactNode;owner?:string;deadline:string;remaining?:string;urgent?:boolean;selected:boolean;onSelect:()=>void;onDismiss?:()=>void}) {
 return <div className={`task-list-row ${selected?'selected':''} stage-${stage}`}><button type="button" className="task-index-item" onClick={onSelect} aria-pressed={selected}>
  <TaskMark stage={stage}/><span className="task-row-content"><span className="task-row-title"><strong>{title}</strong><span className="task-kind">{kind}</span></span><span className="task-row-meta"><span>{subject}</span><time className={urgent?'urgent':''}><Icon name="history" size={14}/>{deadline}{remaining&&<em>（{remaining}）</em>}</time>{owner&&<span><Icon name="people" size={14}/>{owner}</span>}</span></span><span className="task-index-status">{taskStageLabels[stage]}</span>
 </button>{onDismiss&&<div className="task-row-closure"><span>这项任务已关闭。</span><button className="text-button" onClick={onDismiss}>收起任务 <Icon name="close" size={13}/></button></div>}</div>;
}
export function TaskDetailCard({stage,title,kind,code,edit,metadata,purpose,delivery,result,actions,children}: {stage:TaskStage;title:string;kind:string;code:string;edit?:ReactNode;metadata:{label:string;icon:string;value:ReactNode}[];purpose:string;delivery:string;result?:ReactNode;actions?:ReactNode;children?:ReactNode}) {
 return <article className={`task-scene stage-${stage}`}><header className="task-scene-head"><div className="task-scene-top"><span>任务 <span className="task-separator">/</span> {kind}</span><span className="task-scene-id">#{code}</span>{edit}</div><h2>{title}</h2><div className={`task-scene-badge stage-${stage}`}><TaskMark stage={stage}/><span>{taskStageLabels[stage]}</span></div></header>
 <dl className="task-scene-meta-grid">{metadata.map(item=><div key={item.label}><dt><Icon name={item.icon} size={17}/>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
 <section className="task-scene-section"><h3><Icon name="file" size={22}/>任务目的</h3><p>{purpose}</p></section>
 <section className="task-scene-section task-scene-delivery"><h3><Icon name="check" size={22}/>交付要求</h3><p>{delivery}</p></section>{result}
 {actions&&<div className="task-scene-actions">{actions}</div>}{children}
 </article>;
}
