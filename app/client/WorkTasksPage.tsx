import React,{useEffect,useState,type FormEvent} from 'react';
import {api,type Member} from './api';
import {PageError} from './ConnectionPages';
import {Modal,ModalActions} from './Modal';
import './work-tasks.css';

type Scope='all'|'recommended'|'mine'|'admin';
type Task={id:string;archive_id:string|null;kind:'audit'|'onboarding'|'monthly'|'cooperation'|'custom';title:string;purpose:string;delivery:string;status:string;owner_id:string|null;owner_name?:string|null;created_by:string;deadline_at:string;created_at:string;version:number;candidate_count?:number;push_stage?:string};
const labels:Record<Task['kind'],string>={audit:'人事审核',onboarding:'入社对接',monthly:'月度沟通',cooperation:'组织合作',custom:'临时工作'};
const stageLabels:Record<string,string>={initial:'首次推送',reminder:'三日提醒',admin:'管理员队列'};
const deadlineDefault=()=>new Date(Date.now()+7*86400000).toISOString().slice(0,16);
const iso=(value:string)=>new Date(value).toISOString();
const displayDate=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const purposeDefault='说明本次要处理的对象、判断或行动。';
const deliveryDefault='结果写回关联档案；没有关联档案时，在任务结果中交代。';

function CreateTask({onSaved}:{onSaved:()=>void}){
 const[open,setOpen]=useState(false),[kind,setKind]=useState<Task['kind']>('custom'),[title,setTitle]=useState(labels.custom),[purpose,setPurpose]=useState(''),[delivery,setDelivery]=useState(deliveryDefault),[deadline,setDeadline]=useState(deadlineDefault),[error,setError]=useState(''),[busy,setBusy]=useState(false),[advanced,setAdvanced]=useState(false);
 useEffect(()=>{if(!title)setTitle(labels[kind]);},[kind]);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('/work-tasks/create',{kind,title,purpose:purpose||purposeDefault,delivery,deadline_at:iso(deadline),request_id:crypto.randomUUID()});onSaved();setOpen(false);setTitle(labels[kind]);setPurpose('');setDelivery(deliveryDefault);setDeadline(deadlineDefault());setAdvanced(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <>{<button className="button primary work-task-create-button" onClick={()=>{setError('');setOpen(true);}}>新建任务</button>}{open&&<Modal title="新建任务" busy={busy} onClose={()=>setOpen(false)}><form className="manage-form modal-form work-task-create" onSubmit={submit}><label>类型<select value={kind} onChange={e=>{const next=e.target.value as Task['kind'];setKind(next);if(!title||Object.values(labels).includes(title))setTitle(labels[next]);}}>{Object.entries(labels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label>标题<input required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>要处理什么<textarea required maxLength={4000} rows={4} value={purpose} placeholder={purposeDefault} onChange={e=>setPurpose(e.target.value)}/></label><p className="task-defaults">默认交付：{deliveryDefault}<br/>默认接取期限：7 天</p><details className="task-advanced" open={advanced} onToggle={e=>setAdvanced(e.currentTarget.open)}><summary>调整交付和期限</summary><label>交付要求<textarea required maxLength={4000} rows={3} value={delivery} onChange={e=>setDelivery(e.target.value)}/></label><label>接取期限<input required type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}/></label></details><PageError error={error}/><ModalActions><button className="button primary" disabled={busy}>{busy?'正在创建…':'创建任务'}</button></ModalActions></form></Modal>}</>;
}

function CompleteForm({task,onSaved}:{task:Task;onSaved:()=>void}){
 const[kind,setKind]=useState('completed'),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('/work-tasks/complete',{id:task.id,expected_version:task.version,result_kind:kind,result_text:text,request_id:crypto.randomUUID()});onSaved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <form className="work-task-result" onSubmit={submit}><label>完成结果<select value={kind} onChange={e=>setKind(e.target.value)}><option value="completed">已完成</option><option value="continue">建议继续</option><option value="unable_to_contact">暂未联系到</option><option value="not_suitable">不再继续</option></select></label><label>结果说明<textarea required rows={3} maxLength={5000} value={text} onChange={e=>setText(e.target.value)} placeholder="如实交代做了什么、结果是什么、还需要什么"/></label><PageError error={error}/><button className="button primary" disabled={busy}>{busy?'正在提交…':'提交结果并结束任务'}</button></form>;
}

function TaskHistory({task}:{task:Task}){
 const[open,setOpen]=useState(false),[events,setEvents]=useState<{kind:string;actor_name?:string|null;reason?:string|null;created_at:string}[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');
 async function toggle(){if(open){setOpen(false);return;}setOpen(true);if(events.length)return;setLoading(true);try{const r=await api<{events:typeof events}>('/work-tasks/'+task.id);setEvents(r.events);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 return <section className="work-task-history"><button className="text-button" onClick={()=>void toggle()}>{open?'收起历史':'查看操作历史'}</button>{open&&(loading?<p className="history-loading">正在读取…</p>:error?<p className="form-error">{error}</p>:<ol>{events.map((event,index)=><li key={`${event.created_at}-${index}`}><strong>{event.kind.replace('task.','')}</strong><span>{event.actor_name??'系统'} · {displayDate(event.created_at)}</span>{event.reason&&<small>{event.reason}</small>}</li>)}</ol>)}</section>;
}

function TaskCard({task,actor,onChanged}:{task:Task;actor:Member;onChanged:()=>void}){
 const[open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),mine=task.owner_id===actor.id;
 async function claim(){setBusy(true);setError('');try{await api('/work-tasks/claim',{id:task.id,expected_version:task.version,request_id:crypto.randomUUID()});onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function release(){setBusy(true);setError('');try{await api('/work-tasks/release',{id:task.id,expected_version:task.version,deadline_at:iso(deadlineDefault()),request_id:crypto.randomUUID()});onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function cancel(){const reason=window.prompt('取消原因','这项工作不再适用');if(!reason?.trim())return;setBusy(true);setError('');try{await api('/work-tasks/cancel',{id:task.id,expected_version:task.version,reason:reason.trim(),request_id:crypto.randomUUID()});onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const canCancel=task.status==='open'&&(actor.role==='admin'||(task.created_by===actor.id&&!task.owner_id));
 return <article className="work-task-card"><div className="work-task-card-head"><div><span className="work-task-kind">{labels[task.kind]}</span><h2>{task.title}</h2></div><span className={'work-task-state '+(task.owner_id?'claimed':'waiting')}>{task.owner_name??(task.owner_id?'已接取':'待接取')}</span></div><p className="work-task-purpose">{task.purpose}</p><dl><div><dt>交付</dt><dd>{task.delivery}</dd></div><div><dt>期限</dt><dd>{displayDate(task.deadline_at)}</dd></div>{task.archive_id&&<div><dt>关联档案</dt><dd>{task.archive_id}</dd></div>}{task.push_stage&&<div><dt>推送</dt><dd>{stageLabels[task.push_stage]??task.push_stage}{task.candidate_count!==undefined&&` · ${task.candidate_count} 个匹配`}</dd></div>}</dl><TaskHistory task={task}/><div className="work-task-actions"><PageError error={error}/>{task.status==='open'&&!task.owner_id&&<button className="button primary" disabled={busy} onClick={()=>void claim()}>{busy?'正在领取…':'领取任务'}</button>}{mine&&task.status==='open'&&<><button className="button" disabled={busy} onClick={()=>setOpen(v=>!v)}>{open?'收起完成':'提交完成'}</button><button className="button quiet" disabled={busy} onClick={()=>void release()}>主动交还</button></>}{canCancel&&<button className="button quiet" disabled={busy} onClick={()=>void cancel()}>取消任务</button>}{open&&mine&&<CompleteForm task={task} onSaved={onChanged}/>}</div></article>;
}

export function WorkTasksPage({actor}:{actor:Member}){
 const[scope,setScope]=useState<Scope>('all'),[tasks,setTasks]=useState<Task[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 async function load(){setLoading(true);setError('');try{const r=await api<{tasks:Task[]}>('/work-tasks?'+new URLSearchParams({scope}));setTasks(r.tasks);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[scope,revision]);
 const scopes: [Scope,string][]=[['all','全部任务'],['recommended','推荐给我'],['mine','我的任务'],...(actor.role==='admin'?[['admin','管理员队列'] as [Scope,string]]:[])];
 return <main className="account-content work-tasks-page"><div className="section-title section-title-actions"><h1>任务</h1><CreateTask onSaved={()=>setRevision(n=>n+1)}/></div><nav className="work-task-scopes" aria-label="任务范围">{scopes.map(([value,label])=><button key={value} className={scope===value?'active':''} aria-pressed={scope===value} onClick={()=>setScope(value)}>{label}</button>)}</nav><PageError error={error} retry={()=>void load()}/>{loading?<p role="status">正在读取任务…</p>:tasks.length?<div className="work-task-list">{tasks.map(task=><TaskCard key={task.id} task={task} actor={actor} onChanged={()=>setRevision(n=>n+1)}/>)}</div>:<p className="empty-state">这个范围里暂时没有任务。</p>}</main>;
}
