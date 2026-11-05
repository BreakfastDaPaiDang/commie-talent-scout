import React from 'react';
import './statistics-navigation.css';
export type GraphView='people'|'resources'|'rules';
export function StatisticsNavigation({graph,onOverview,onGraph,view,onView}:{graph:boolean;onOverview:()=>void;onGraph:()=>void;view?:GraphView;onView?:(view:GraphView)=>void}){
 return <div className="statistics-navigation"><nav aria-label="统计下辖页面"><button className={!graph?'active':''} aria-current={!graph?'page':undefined} onClick={onOverview}>统计概览</button><button className={graph?'active':''} aria-current={graph?'page':undefined} onClick={onGraph}>人员与资源图谱</button></nav>{graph&&onView&&<nav className="statistics-graph-views" aria-label="图谱视图">{([['people','人员流向'],['resources','社内承接资源'],['rules','系统联动图']] as const).map(([id,title])=><button key={id} className={view===id?'active':''} aria-current={view===id?'page':undefined} onClick={()=>onView(id)}>{title}</button>)}</nav>}</div>;
}
