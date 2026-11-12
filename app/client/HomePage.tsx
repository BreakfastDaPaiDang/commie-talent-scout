import React from 'react';
import {TopBar} from '../ui/Workspace';
import {WhaleHome} from '../ui/WhaleHome';

export function HomePage({memberName,onNavigate}:{memberName?:string;onNavigate:(href:string)=>void}){
 return <div className="app whale-home-shell">
  <TopBar onHome={()=>onNavigate('/')} navigation={null}
   tools={<button className="whale-home-account" onClick={()=>onNavigate(memberName?'/account/profile':'/login')}>{memberName??'登录'}</button>}/>
  <WhaleHome onNavigate={onNavigate}/>
 </div>;
}
