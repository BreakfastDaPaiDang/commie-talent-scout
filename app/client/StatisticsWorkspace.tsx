import React,{useEffect,useState} from 'react';
import {StatisticsNavigation,type GraphView} from '../ui/StatisticsNavigation';
import {InternalResources} from '../ui/InternalResources';
import {internalResourceAdapter} from './internal-resource-adapter';
import {StatisticsPage} from './StatisticsPage';
import {PersonnelMapPage} from './PersonnelMapPage';
import {InteractionRulesPage} from './InteractionRulesPage';
import type {Member} from './api';
export function canonicalStatisticsPath(path:string){const url=new URL(path,location.origin);if(url.pathname==='/personnel')return '/statistics/flow?view=people';if(url.pathname==='/rules')return '/statistics/flow?view=rules';return url.pathname+url.search+url.hash;}
const selectedView=():GraphView=>{const value=new URLSearchParams(location.search).get('view');return value==='rules'||value==='resources'?value:'people';};
export function StatisticsWorkspace({actor,path,onNavigate}:{actor:Member;path:string;onNavigate:(path:string)=>void}){
 const [view,setView]=useState<GraphView>(selectedView),graph=path==='/statistics/flow';
 useEffect(()=>{const change=()=>setView(selectedView());window.addEventListener('popstate',change);return()=>window.removeEventListener('popstate',change);},[]);
 useEffect(()=>setView(selectedView()),[path]);
 function withinNavigate(next:string){const u=new URL(canonicalStatisticsPath(next),location.origin);if(u.pathname==='/statistics/flow'){const v=u.searchParams.get('view');setView(v==='resources'||v==='rules'?v:'people');}onNavigate(next);}
 function route(path:string,value?:GraphView){const params=new URLSearchParams(location.search);if(value)params.set('view',value);return path+'?'+params;}
 function choose(value:GraphView){setView(value);onNavigate(route('/statistics/flow',value));}
 return <><StatisticsNavigation graph={graph} onOverview={()=>onNavigate(route('/statistics'))} onGraph={()=>choose('people')} view={view} onView={choose}/>{!graph?<StatisticsPage/>:view==='resources'?<InternalResources adapter={internalResourceAdapter} urlState/>:view==='rules'?<InteractionRulesPage memberId={actor.id} onNavigate={withinNavigate}/>:<PersonnelMapPage actor={actor} onNavigate={withinNavigate}/>}</>;
}
