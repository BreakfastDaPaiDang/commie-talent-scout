import React,{useEffect,useState,type CSSProperties,type FormEvent} from 'react';
import {api,type Member} from './api';
import {PageError} from './ConnectionPages';
import {Modal,ModalActions} from './Modal';
import {Avatar} from './Avatar';
import {avatarUrl} from './AvatarEditor';
import './work-tasks.css';

type Scope='all'|'recommended'|'mine'|'admin';
export type ArchivePreview={id:string;type:'person'|'org';name:string;status:string;version:number;updated_at:string;observation_count:number;latest_observation:string|null;members:{id:string;name:string;frozen:boolean}[];tag_summary:{tags:{tag_id:string;category_name:string;name:string;color:string;focus:number}[];total:number}};
type Task={id:string;archive_id:string|null;archive_preview?:ArchivePreview;kind:'audit'|'onboarding'|'monthly'|'cooperation'|'custom';title:string;purpose:string;delivery:string;status:string;owner_id:string|null;owner_name?:string|null;created_by:string;deadline_at:string;created_at:string;version:number;candidate_count?:number;push_stage?:string};
const labels:Record<Task['kind'],string>={audit:'人事审核',onboarding:'入社对接',monthly:'月度沟通',cooperation:'组织合作',custom:'临时工作'};
const stageLabels:Record<string,string>={initial:'首次推送',reminder:'三日提醒',admin:'管理员队列'};
const deadlineDefault=()=>new Date(Date.now()+7*86400000).toISOString().slice(0,16);
const iso=(value:string)=>new Date(value).toISOString();
const displayDate=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
const purposeDefault='说明本次要处理的对象、判断或行动。';
const deliveryDefault='结果写回关联档案；没有关联档案时，在任务结果中交代。';

function ArchivePeek({archive,onOpen}:{archive:ArchivePreview;onOpen:(archive:ArchivePreview)=>void}){
 const[open,setOpen]=useState(false),timer=React.useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const later=(next:boolean)=>{if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setOpen(next),next?90:150);};
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 const tags=archive.tag_summary.tags.slice(0,3);
 return <span className="task-archive-anchor" onMouseEnter={()=>later(true)} onMouseLeave={()=>later(false)}>
  <button className="task-archive-link" type="button" onFocus={()=>later(true)} onBlur={()=>later(false)} onClick={()=>onOpen(archive)} aria-haspopup="dialog" aria-expanded={open}>
   <Avatar name={archive.name} type={archive.type} size="micro" src={avatarUrl('archive',archive.id,archive.version)}/>
   <span className="task-archive-copy"><strong>{archive.name}</strong><small>{archive.status}</small></span>
  </button>
  {open&&<aside className="archive-peek" role="dialog" aria-label={`${archive.name}档案速览`} onFocus={()=>later(true)} onMouseEnter={()=>later(true)} onMouseLeave={()=>later(false)}>
   <header><Avatar name={archive.name} type={archive.type} size="tiny" src={avatarUrl('archive',archive.id,archive.version)}/><div><strong>{archive.name}</strong><span>{archive.status}</span></div><button className="archive-peek-close" type="button" aria-label="关闭速览" onClick={()=>setOpen(false)}>×</button></header>
   {tags.length>0&&<div className="archive-peek-tags">{tags.map(tag=><span key={tag.tag_id} style={{'--tag-color':tag.color} as CSSProperties}>{tag.category_name}：{tag.name}</span>)}</div>}
   <p>{archive.latest_observation??'还没有观察记录。'}</p>
   <footer><small>{archive.observation_count} 条观察</small><button type="button" className="text-button" onClick={()=>onOpen(archive)}>打开档案</button></footer>
  </aside>}
 </span>;
}

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

function taskActionTitle(task:Task){
 const name=task.archive_preview?.name;
 return name&&task.title.startsWith(`${name} · `)?task.title.slice(name.length+3):task.title;
}

function TaskIndexItem({task,actor,selected,onSelect}:{task:Task;actor:Member;selected:boolean;onSelect:()=>void}){
 const mine=task.owner_id===actor.id,soon=Date.parse(task.deadline_at)-Date.now()<=3*86400000;
 return <button type="button" className={'task-index-item '+(selected?'selected':'')} onClick={onSelect} aria-pressed={selected}>
  <strong>{taskActionTitle(task)}</strong>
  {task.archive_preview?<span className="task-index-subject"><Avatar name={task.archive_preview.name} type={task.archive_preview.type} size="micro"/><b>{task.archive_preview.name}</b></span>:<span className="task-index-subject task-index-unlinked">未关联档案</span>}
  <footer><span className={mine?'task-index-owner mine':!task.owner_id?'task-index-owner waiting':'task-index-owner'}>{mine?'我负责':task.owner_name??'待接取'}</span><time className={soon?'soon':''}>{soon?'即将到期 · ':''}{displayDate(task.deadline_at)}</time></footer>
 </button>;
}

function TaskScene({task,actor,onChanged,onOpenArchive}:{task:Task;actor:Member;onChanged:()=>void;onOpenArchive:(archive:ArchivePreview,taskId:string)=>void}){
 const[open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[flash,setFlash]=useState(''),mine=task.owner_id===actor.id;
 function changed(kind:string){setFlash(kind);onChanged();window.setTimeout(()=>setFlash(''),500);}
 async function claim(){setBusy(true);setError('');try{await api('/work-tasks/claim',{id:task.id,expected_version:task.version,request_id:crypto.randomUUID()});changed('claimed');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function release(){setBusy(true);setError('');try{await api('/work-tasks/release',{id:task.id,expected_version:task.version,deadline_at:iso(deadlineDefault()),request_id:crypto.randomUUID()});changed('released');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function cancel(){const reason=window.prompt('取消原因','这项工作不再适用');if(!reason?.trim())return;setBusy(true);setError('');try{await api('/work-tasks/cancel',{id:task.id,expected_version:task.version,reason:reason.trim(),request_id:crypto.randomUUID()});changed('cancelled');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const canCancel=task.status==='open'&&(actor.role==='admin'||(task.created_by===actor.id&&!task.owner_id));
 return <article className={`task-scene ${flash?'flash-'+flash:''}`}>
  <header className="task-scene-head"><div><h2>{taskActionTitle(task)}</h2></div></header>
  <div className="task-scene-subject">{task.archive_preview?<ArchivePeek archive={task.archive_preview} onOpen={archive=>onOpenArchive(archive,task.id)}/>:<span className="task-scene-unlinked">未关联档案</span>}</div>
  <div className="task-scene-signal"><span className={'work-task-state '+(task.owner_id?'claimed':'waiting')}>{task.owner_name??(task.owner_id?'已接取':'待接取')}</span><span className="task-scene-meta">截止 {displayDate(task.deadline_at)}</span>{task.push_stage&&<span className="task-scene-meta">{stageLabels[task.push_stage]??task.push_stage}{task.candidate_count!==undefined&&` · ${task.candidate_count} 个匹配`}</span>}</div>
  <section className="task-scene-purpose"><p>{task.purpose}</p></section>
  <details className="task-scene-delivery"><summary>交付要求</summary><p>{task.delivery}</p></details>
  <TaskHistory task={task}/>
  <div className="task-scene-actions"><PageError error={error}/>{task.status==='open'&&!task.owner_id&&<button className="button primary" disabled={busy} onClick={()=>void claim()}>{busy?'正在领取…':'领取任务'}</button>}{mine&&task.status==='open'&&<><button className="button primary" disabled={busy} onClick={()=>setOpen(v=>!v)}>{open?'收起完成':'提交完成'}</button><button className="button quiet" disabled={busy} onClick={()=>void release()}>主动交还</button></>}{!mine&&task.owner_id&&<p className="task-scene-owner">由 {task.owner_name??'其他成员'} 负责</p>}{canCancel&&<button className="button quiet" disabled={busy} onClick={()=>void cancel()}>取消任务</button>}{open&&mine&&<CompleteForm task={task} onSaved={()=>changed('completed')}/>}</div>
 </article>;
}

export function WorkTasksPage({actor,onOpenArchive}:{actor:Member;onOpenArchive:(archive:ArchivePreview,taskId?:string)=>void}){
 const[scope,setScope]=useState<Scope>('all'),[tasks,setTasks]=useState<Task[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const[selectedId,setSelectedId]=useState<string|null>(()=>new URLSearchParams(location.search).get('task'));
 async function load(){setLoading(true);setError('');try{const r=await api<{tasks:Task[]}>('/work-tasks?'+new URLSearchParams({scope}));setTasks(r.tasks);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[scope,revision]);
 const selectedTask=tasks.find(task=>task.id===selectedId)??null;
 const updateSelection=(id:string|null)=>{setSelectedId(id);const params=new URLSearchParams(location.search);if(id)params.set('task',id);else params.delete('task');history.replaceState(null,'',location.pathname+(params.size?'?'+params.toString():''));};
 useEffect(()=>{if(loading)return;if(selectedId&&tasks.some(task=>task.id===selectedId))return;const first=tasks.find(task=>task.owner_id===actor.id)||tasks.find(task=>!task.owner_id)||tasks[0]||null;if(first)updateSelection(first.id);},[loading,selectedId,tasks,actor.id]);
 const scopes: [Scope,string][]=[['all','全部任务'],['recommended','推荐给我'],['mine','我的任务'],...(actor.role==='admin'?[['admin','管理员队列'] as [Scope,string]]:[])];
 const soon=(task:Task)=>task.status==='open'&&task.owner_id===null&&Date.parse(task.deadline_at)-Date.now()<=3*86400000;
 const groups=[{key:'attention',title:'现在需要处理',items:tasks.filter(task=>task.owner_id===actor.id||soon(task))},{key:'waiting',title:'等待接手',items:tasks.filter(task=>!task.owner_id&&!soon(task))},{key:'active',title:'其他进行中',items:tasks.filter(task=>!!task.owner_id&&task.owner_id!==actor.id)}];
 const visibleGroups=groups.filter(group=>group.items.length>0);
 return <main className="account-content work-tasks-page task-workspace"><header className="task-workspace-head"><h1>任务</h1><CreateTask onSaved={()=>setRevision(n=>n+1)}/></header><nav className="work-task-scopes" aria-label="任务范围">{scopes.map(([value,label])=><button key={value} className={scope===value?'active':''} aria-pressed={scope===value} onClick={()=>{setScope(value);updateSelection(null);}}>{label}<small>{value==='all'?tasks.length:value==='mine'?tasks.filter(task=>task.owner_id===actor.id).length:value==='recommended'?tasks.filter(task=>!task.owner_id).length:tasks.length}</small></button>)}</nav><PageError error={error} retry={()=>void load()}/>{loading?<p role="status">正在读取任务…</p>:<div className={'task-workspace-grid '+(selectedTask?'has-selection':'')}><section className="task-index" aria-label="任务索引">{visibleGroups.map(group=><section className="task-index-group" key={group.key}><header><div><h2>{group.title}<span>{group.items.length}</span></h2></div></header><div className="task-index-list">{group.items.map(task=><TaskIndexItem key={task.id} task={task} actor={actor} selected={selectedId===task.id} onSelect={()=>updateSelection(task.id)}/>)}</div></section>)}{!visibleGroups.length&&<p className="task-index-empty">暂时没有任务</p>}</section>{selectedTask?<TaskScene key={selectedTask.id} task={selectedTask} actor={actor} onChanged={()=>setRevision(n=>n+1)} onOpenArchive={onOpenArchive}/>:<aside className="task-scene-empty"><span className="task-scene-empty-mark">+</span><h2>选择一项工作</h2><p>从左侧任务索引开始。</p></aside>}</div>}</main>;
}
