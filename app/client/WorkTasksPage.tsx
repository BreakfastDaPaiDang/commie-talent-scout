import React,{useEffect,useState,type FormEvent} from 'react';
import {api,type Member} from './api';
import {PageError} from './ConnectionPages';
import './work-tasks.css';

type Scope='all'|'recommended'|'mine'|'admin';
type Task={id:string;archive_id:string|null;kind:'audit'|'onboarding'|'monthly'|'cooperation'|'custom';title:string;purpose:string;delivery:string;status:string;owner_id:string|null;owner_name?:string|null;deadline_at:string;created_at:string;version:number;candidate_count?:number;push_stage?:string};
const labels:Record<Task['kind'],string>={audit:'人事审核',onboarding:'入社对接',monthly:'月度沟通',cooperation:'组织合作',custom:'临时工作'};
const stageLabels:Record<string,string>={initial:'首次推送',reminder:'三日提醒',admin:'管理员队列'};
const deadlineDefault=()=>new Date(Date.now()+7*86400000).toISOString().slice(0,16);
const iso=(value:string)=>new Date(value).toISOString();
const displayDate=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});

function CreateTask({onSaved}:{onSaved:()=>void}){
 const[kind,setKind]=useState<Task['kind']>('custom'),[title,setTitle]=useState(''),[purpose,setPurpose]=useState(''),[delivery,setDelivery]=useState(''),[deadline,setDeadline]=useState(deadlineDefault),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!title)setTitle(labels[kind]);},[kind]);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('/work-tasks/create',{kind,title,purpose,delivery,deadline_at:iso(deadline),request_id:crypto.randomUUID()});onSaved();setTitle('');setPurpose('');setDelivery('');setDeadline(deadlineDefault());}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <details className="work-task-create"><summary>发起临时工作</summary><form className="manage-form" onSubmit={submit}><p className="secondary-copy">系统会自动带出责任、期限和推荐对象；这里填写本次要解决什么、交付到哪里。</p><label>任务类型<select value={kind} onChange={e=>setKind(e.target.value as Task['kind'])}>{Object.entries(labels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>标题<input required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>任务目的<textarea required maxLength={4000} rows={3} value={purpose} onChange={e=>setPurpose(e.target.value)}/></label><label>交付要求<textarea required maxLength={4000} rows={3} value={delivery} onChange={e=>setDelivery(e.target.value)}/></label><label>接取期限<input required type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}/></label><PageError error={error}/><button className="button primary" disabled={busy}>{busy?'正在创建…':'创建并进入看板'}</button></form></details>;
}

function CompleteForm({task,onSaved}:{task:Task;onSaved:()=>void}){
 const[kind,setKind]=useState('completed'),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('/work-tasks/complete',{id:task.id,expected_version:task.version,result_kind:kind,result_text:text,request_id:crypto.randomUUID()});onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <form className="work-task-result" onSubmit={submit}><label>完成结果<select value={kind} onChange={e=>setKind(e.target.value)}><option value="completed">已完成</option><option value="continue">建议继续</option><option value="unable_to_contact">暂未联系到</option><option value="not_suitable">不再继续</option></select></label><label>结果说明<textarea required rows={3} maxLength={5000} value={text} onChange={e=>setText(e.target.value)} placeholder="如实交代做了什么、结果是什么、还需要什么"/></label><PageError error={error}/><button className="button primary" disabled={busy}>{busy?'正在提交…':'提交结果并结束任务'}</button></form>;
}

function TaskCard({task,actor,onChanged}:{task:Task;actor:Member;onChanged:()=>void}){
 const[open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),mine=task.owner_id===actor.id;
 async function claim(){setBusy(true);setError('');try{await api('/work-tasks/claim',{id:task.id,expected_version:task.version,request_id:crypto.randomUUID()});onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function release(){setBusy(true);setError('');try{await api('/work-tasks/release',{id:task.id,expected_version:task.version,deadline_at:iso(deadlineDefault()),request_id:crypto.randomUUID()});onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <article className="work-task-card"><div className="work-task-card-head"><div><span className="work-task-kind">{labels[task.kind]}</span><h2>{task.title}</h2></div><span className={'work-task-state '+(task.owner_id?'claimed':'waiting')}>{task.owner_name??(task.owner_id?'已接取':'待接取')}</span></div><p className="work-task-purpose">{task.purpose}</p><dl><div><dt>交付</dt><dd>{task.delivery}</dd></div><div><dt>期限</dt><dd>{displayDate(task.deadline_at)}</dd></div>{task.archive_id&&<div><dt>关联档案</dt><dd>{task.archive_id}</dd></div>}{task.push_stage&&<div><dt>推送</dt><dd>{stageLabels[task.push_stage]??task.push_stage}{task.candidate_count!==undefined&&` · ${task.candidate_count} 个匹配`}</dd></div>}</dl><div className="work-task-actions"><PageError error={error}/>{task.status==='open'&&!task.owner_id&&<button className="button primary" disabled={busy} onClick={()=>void claim()}>{busy?'正在领取…':'领取任务'}</button>}{mine&&task.status==='open'&&<><button className="button" disabled={busy} onClick={()=>setOpen(v=>!v)}>{open?'收起完成':'提交完成'}</button><button className="button quiet" disabled={busy} onClick={()=>void release()}>主动交还</button></>}{open&&mine&&<CompleteForm task={task} onSaved={onChanged}/>}</div></article>;
}

export function WorkTasksPage({actor}:{actor:Member}){
 const[scope,setScope]=useState<Scope>('all'),[tasks,setTasks]=useState<Task[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 async function load(){setLoading(true);setError('');try{const r=await api<{tasks:Task[]}>('/work-tasks?'+new URLSearchParams({scope}));setTasks(r.tasks);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[scope,revision]);
 const scopes: [Scope,string][]=[['all','全部任务'],['recommended','推荐给我'],['mine','我的任务'],...(actor.role==='admin'?[['admin','管理员队列'] as [Scope,string]]:[])];
 return <main className="account-content work-tasks-page"><div className="section-title section-title-actions"><div><p className="eyebrow">协作工作台</p><h1>任务</h1><p>先看目的、交付、责任和期限；待接取任务由成员主动领取。</p></div><CreateTask onSaved={()=>setRevision(n=>n+1)}/></div><nav className="work-task-scopes" aria-label="任务范围">{scopes.map(([value,label])=><button key={value} className={scope===value?'active':''} aria-pressed={scope===value} onClick={()=>setScope(value)}>{label}</button>)}</nav><PageError error={error} retry={()=>void load()}/>{loading?<p role="status">正在读取任务…</p>:tasks.length?<div className="work-task-list">{tasks.map(task=><TaskCard key={task.id} task={task} actor={actor} onChanged={()=>setRevision(n=>n+1)}/>)}</div>:<p className="empty-state">这个范围里暂时没有任务。</p>}</main>;
}
