import React,{useEffect,useState} from 'react';
import {CaughtUp,WorkspaceFrame} from '../ui/Workspace';
import {PageError} from './ConnectionPages';
import {api} from './api';
import './messages.css';

type Message={id:string;kind:string;task_id:string|null;title:string;body:string;deadline_at:string|null;created_at:string;read:boolean;task_status:string|null;archive_id:string|null;archive_name:string|null};
const kindLabel:Record<string,string>={task_deadline_reminder:'任务截止提醒',task_expired_uncompleted:'任务已逾期'};

function time(value:string){return new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});}

export function MessagesPage({compact=false}:{compact?:boolean}){
 const[messages,setMessages]=useState<Message[]>([]),[selected,setSelected]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null);
 async function load(){setLoading(true);setError('');try{const result=await api<{messages:Message[]}>('/messages?limit=100');setMessages(result.messages);setSelected(current=>current&&result.messages.some(m=>m.id===current)?current:result.messages[0]?.id??null);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 async function markRead(message:Message){if(message.read)return;setBusy(message.id);try{await api('/messages/read',{ids:[message.id]});setMessages(old=>old.map(item=>item.id===message.id?{...item,read:true}:item));window.dispatchEvent(new CustomEvent('cts-messages-read',{detail:{id:message.id}}));}catch(e){setError((e as Error).message);}finally{setBusy(null);}}
 const current=messages.find(message=>message.id===selected)??null;
 return <WorkspaceFrame selected={!!current} list={<main className="messages-page">{!compact&&<header className="page-head"><div><h1>任务提醒</h1><p className="section-description">任务提醒与截止结果。读取消息不会改变任务状态。</p></div><button className="button" onClick={()=>void load()} disabled={loading}>刷新</button></header>}{compact&&<div className="notification-refresh"><p className="section-description">任务提醒与截止结果。读取消息不会改变任务状态。</p><button className="button" onClick={()=>void load()} disabled={loading}>刷新</button></div>}<PageError error={error} retry={()=>void load()}/>{loading?<p className="stream-status">正在读取消息…</p>:!messages.length?<CaughtUp action={undefined}/>:<section className="messages-list" aria-label="任务提醒列表">{messages.map(message=><button key={message.id} className={`message-row ${message.id===selected?'selected':''} ${message.read?'read':''}`} onClick={()=>{setSelected(message.id);void markRead(message);}}><span className="message-kind">{kindLabel[message.kind]??'消息'}</span><strong>{message.title}</strong><span>{message.archive_name??'任务看板'}</span><time>{time(message.created_at)}</time>{!message.read&&<i aria-label="未读"/>}</button>)}</section>}</main>} detail={current?<aside className="detail-panel message-detail"><div className="detail-top"><span>{kindLabel[current.kind]??'消息'}</span><button className="icon-button" aria-label="关闭消息" onClick={()=>setSelected(null)}>×</button></div><div className="detail-inner"><h2>{current.title}</h2><p>{current.body}</p>{current.deadline_at&&<p className="message-deadline">截止：{time(current.deadline_at)}</p>}{current.task_id&&<p className="message-task-id">任务：{current.task_id}</p>}{!current.read&&<button className="button" disabled={busy===current.id} onClick={()=>void markRead(current)}>{busy===current.id?'正在标记…':'标记已读'}</button>}</div></aside>:<aside className="selection-rest"><span>选择一条任务提醒查看详情。</span></aside>}/>;
}
