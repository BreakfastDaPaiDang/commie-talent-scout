import React,{useState} from 'react';
import {MessagesPage} from './MessagesPage';
import {UnreadPage} from './UnreadPage';
import type {Member} from './api';
import './notifications.css';

type Tab='tasks'|'updates';

export function NotificationCenter({actor}:{actor:Member}){
 const initial:Tab=location.pathname==='/unread'||new URLSearchParams(location.search).get('tab')==='updates'?'updates':'tasks';
 const[tab,setTab]=useState<Tab>(initial);
 function select(next:Tab){setTab(next);history.replaceState(null,'',`/messages${next==='updates'?'?tab=updates':''}`);}
 return <main className="notification-center">
  <nav className="notification-tabs" aria-label="消息类型">
   <button className={tab==='tasks'?'active':''} aria-current={tab==='tasks'?'page':undefined} onClick={()=>select('tasks')}>任务提醒</button>
   <button className={tab==='updates'?'active':''} aria-current={tab==='updates'?'page':undefined} onClick={()=>select('updates')}>档案更新</button>
  </nav>
  {tab==='tasks'?<MessagesPage compact/>:<UnreadPage actor={actor} compact/>}
 </main>;
}
