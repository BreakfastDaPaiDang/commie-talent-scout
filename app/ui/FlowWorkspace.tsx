import React,{useEffect,useRef,useState,type ReactNode} from 'react';
import {TopBar,TabList} from './Workspace';
import {Icon} from './icons';
import {Modal,ModalActions} from './Modal';
import {flowResults,flowTaskTypes,type FlowAction,type FlowActor,type FlowData,type FlowPage,type FlowPerson,type FlowTask} from './flow-types';
import './flow-workspace.css';

type Props={data:FlowData;actor:FlowActor;actors:FlowActor[];page:FlowPage;onPage:(page:FlowPage)=>void;selectedId:string|null;onSelect:(id:string|null)=>void;onAction:(action:FlowAction)=>boolean;notice:string;error:string;controls?:ReactNode;statistics?:ReactNode};
type Dialog={kind:'join'|'complete'|'release'|'extend'|'reopen'|'cancel';task?:FlowTask};
const labels:Record<FlowPage,string>={tasks:'任务',external:'外部人物',members:'社员',org:'组织',messages:'消息提醒',statistics:'统计',tags:'标签库'};
const day=(date:string)=>new Date(date).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'});
const fullTime=(date:string)=>new Date(date).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
function Avatar({name,org=false}:{name:string;org?:boolean}){return <span className={'fw-avatar '+(org?'fw-org':'')} aria-hidden="true">{org?<Icon name="org"/>:name.slice(-1)}</span>;}
function Button({children,primary=false,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&{primary?:boolean}){return <button type="button" className={'fw-button '+(primary?'fw-primary':'')} {...props}>{children}</button>;}
function Status({task}:{task:FlowTask}){return <span className={'fw-status '+(!task.open?(task.result==='completed'?'success':'muted'):task.ownerId?'active':'waiting')}>{task.open?(task.ownerId?'正在进行':'待接手'):flowResults[task.result!]}</span>;}

export function FlowWorkspace({data,actor,actors,page,onPage,selectedId,onSelect,onAction,notice,error,controls,statistics}:Props){
 const[scope,setScope]=useState('all'),[query,setQuery]=useState(''),[type,setType]=useState('all'),[taskId,setTaskId]=useState<string|null>(null),[tab,setTab]=useState('overview'),[dialog,setDialog]=useState<Dialog|null>(null),[text,setText]=useState(''),[deadline,setDeadline]=useState(''),[note,setNote]=useState(''),[comment,setComment]=useState('');
 const[resultNotes,setResultNotes]=useState<string[]>([]),[targetNote,setTargetNote]=useState<string|null>(null);
 const noteElements=useRef(new Map<string,HTMLElement>());
 useEffect(()=>{if(tab==='notes'&&targetNote){const node=noteElements.current.get(targetNote);node?.scrollIntoView({block:'center'});node?.focus({preventScroll:true});}},[tab,targetNote]);
 useEffect(()=>{setDialog(null);setComment('');},[actor.id]);
 const person=data.people.find(p=>p.id===selectedId);
 const related=data.tasks.filter(t=>t.personId===selectedId);
 const task=related.find(t=>t.id===taskId)??related.find(t=>t.open&&(person?.member?t.type==='onboarding':t.type==='audit'))??related.find(t=>t.open)??related[0];
 const actorName=(id:string|null)=>actors.find(a=>a.id===id)?.name??'待接手';
 const notes=data.notes.filter(n=>n.personId===selectedId);
 const unread=data.messages.filter(m=>m.ownerId===actor.id&&!m.read).length;
 function navigate(next:FlowPage){onPage(next);onSelect(null);setTaskId(null);setQuery('');setTab('overview');}
 function select(p:FlowPerson,t?:FlowTask){onSelect(p.id);setTaskId(t?.id??null);setTab('overview');setNote('');setComment('');setTargetNote(null);}
 function showNote(id:string){setTargetNote(id);setTab('notes');}
 function open(kind:Dialog['kind']){setText('');setResultNotes(task?.noteIds??[]);setDeadline(new Date(Math.max(Date.parse(data.now),Date.parse(task?.deadline??data.now))+7*86400000).toISOString().slice(0,10));setDialog({kind,task});}
 function submit(){if(!dialog||!person)return;const ok=dialog.kind==='join'?onAction({type:'join',personId:person.id}):onAction({type:dialog.kind,taskId:dialog.task!.id,body:text,deadline:deadline+'T18:00:00+08:00',noteIds:resultNotes});if(ok){setDialog(null);if(dialog.kind==='join')setTaskId(null);}}
 const filteredTasks=data.tasks.filter(t=>{
  const p=data.people.find(p=>p.id===t.personId)!;
  return (scope==='all'||(scope==='mine'?t.ownerId===actor.id:t.open&&!t.ownerId))&&(type==='all'||t.type===type)&&`${t.title} ${p.name}`.includes(query);
 });
 const people=data.people.filter(p=>(page==='org'?p.kind==='org':p.kind==='person'&&p.member===(page==='members'))&&`${p.name} ${p.subtitle} ${p.tags.join(' ')}`.includes(query));
 const auditDone=related.some(t=>t.type==='audit'&&t.result==='completed');
 const onboardingDone=related.some(t=>t.type==='onboarding'&&t.result==='completed');
 const canWork=!!task?.open&&task.ownerId===actor.id;
 const ownTask=task?.ownerId===actor.id;
 const confirmJoin=person?.kind==='person'&&!person.member;
 function mainAction(){
  if(!person)return null;
  if(task?.open){if(!task.ownerId)return <Button primary onClick={()=>onAction({type:'claim',taskId:task.id})}>{task.type==='onboarding'?'领取对接':task.type==='audit'?'领取审核':'领取任务'}<Icon name="arrow"/></Button>;if(canWork)return <Button primary onClick={()=>open('complete')}>完成{task.type==='audit'?'审核':task.type==='onboarding'?'对接':'任务'}<Icon name="check"/></Button>;return <span className="fw-help">由 {actorName(task.ownerId)} 接手，等待交付</span>;}
  if(confirmJoin&&auditDone)return <Button primary onClick={()=>open('join')}>确认入社<Icon name="arrow"/></Button>;
  if(task&&!task.open&&(ownTask||actor.role==='admin'))return <Button onClick={()=>open('reopen')}>重新开启任务</Button>;
  if(confirmJoin)return <Button primary onClick={()=>onAction({type:'refer',personId:person.id})}>发起引荐<Icon name="arrow"/></Button>;
  return <span className="fw-help">本次工作已结束，档案继续维护</span>;
 }
 const modalTitles={join:'确认正式入社',complete:'完成并交代结果',release:'交还任务',extend:'主动延期',reopen:'重新开启任务',cancel:'取消任务'};
 return <div className="flow-workspace">
  <TopBar onHome={()=>navigate('tasks')} navigation={<>{(['external','org','members','tasks','statistics'] as FlowPage[]).map(p=><button key={p} className={page===p?'active':''} aria-current={page===p?'page':undefined} onClick={()=>navigate(p)}>{labels[p]}</button>)}</>} tools={<><button className={'fw-bell '+(page==='messages'?'active':'')} aria-label={`消息提醒，${unread} 条未读`} onClick={()=>navigate('messages')}><Icon name="bell"/>{unread>0&&<span>{unread}</span>}</button><details className="fw-account"><summary><Avatar name={actor.name}/>{actor.name}<Icon name="down" size={14}/></summary><div><button onClick={()=>navigate('tags')}>标签库</button><a href="/?page=agent">Agent 接入</a>{actor.role==='admin'&&<a href="/">猎头管理 · 现有原型</a>}</div></details></>}/>
  {controls}
  <div className={'fw-layout '+(person?'has-person':'')}>
   <main className="fw-main">
    <header className="fw-page-head"><h1>{labels[page]}</h1><span className="fw-date">{day(data.now)}</span></header>
    {notice&&<div className="fw-notice" role="status"><Icon name="check"/>{notice}</div>}
    {error&&!dialog&&<p className="fw-error" role="alert">{error}</p>}
    {['tasks','external','members','org'].includes(page)&&<div className="fw-toolbar">{page==='tasks'?<div className="fw-scopes" aria-label="任务范围">{[['all','全组任务'],['mine','我负责'],['waiting','待领取']].map(([key,label])=><button key={key} aria-pressed={scope===key} onClick={()=>setScope(key)}>{label}<span>{key==='all'?data.tasks.length:key==='mine'?data.tasks.filter(t=>t.ownerId===actor.id).length:data.tasks.filter(t=>t.open&&!t.ownerId).length}</span></button>)}</div>:<span className="fw-total">{people.length} 份档案</span>}<div className="fw-search"><Icon name="search"/><input aria-label="搜索工作台" placeholder="搜索名称或工作" value={query} onChange={e=>setQuery(e.target.value)}/></div>{page==='tasks'&&<select aria-label="任务类型" value={type} onChange={e=>setType(e.target.value)}><option value="all">所有类型</option>{Object.entries(flowTaskTypes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>}</div>}
    {page==='tasks'&&<div className="fw-board">{[['waiting','待领取','尚未有人接手'],['active','正在进行','由接取者推进'],['closed','已结束','结果与历史保留']].map(([key,title,subtitle])=>{const rows=filteredTasks.filter(t=>key==='closed'?!t.open:key==='active'?t.open&&!!t.ownerId:t.open&&!t.ownerId);return <section className={'fw-column '+key} key={key}><header><h2><i/>{title}<span>{rows.length}</span></h2><p>{subtitle}</p></header><div className="fw-task-list">{rows.map(t=>{const p=data.people.find(p=>p.id===t.personId)!;const soon=t.open&&Date.parse(t.deadline)-Date.parse(data.now)<=86400000;return <button key={t.id} className={'fw-task-card '+(task?.id===t.id?'selected':'')} onClick={()=>select(p,t)} aria-label={`查看任务：${t.title}`}><span className={'fw-type '+t.type}>{flowTaskTypes[t.type]}</span><h3>{t.title}</h3><div className="fw-person-line"><Avatar name={p.name} org={p.kind==='org'}/><span>{p.name}</span><small>{p.member?'社员':p.kind==='org'?'组织':'外部人物'}</small></div><p className="fw-task-purpose">{t.purpose}</p><footer><span className={soon?'fw-due':''}>{soon?'即将到期 · ':''}{day(t.deadline)}</span>{t.open?<span className={!t.ownerId?'fw-unclaimed':''}>{actorName(t.ownerId)}</span>:<Status task={t}/>}</footer>{t.month&&<small className="fw-month">{t.month} · 独立周期</small>}</button>;})}{!rows.length&&<div className="fw-empty"><Icon name="check"/><p>{query?'没有匹配的工作':'这里暂时没有任务'}</p></div>}</div></section>;})}</div>}
    {['external','members','org'].includes(page)&&<div className="fw-people">{people.map(p=>{const jobs=data.tasks.filter(t=>t.personId===p.id&&t.open);const pending=jobs.filter(t=>!t.ownerId);return <button key={p.id} className={'fw-person-card '+(selectedId===p.id?'selected':'')} onClick={()=>select(p)} aria-label={`打开档案：${p.name}`}><div className="fw-person-top"><Avatar name={p.name} org={p.kind==='org'}/><div><h2>{p.name}</h2><small>{p.member?'社员':p.relation}</small></div><Icon name="arrow"/></div><p>{p.subtitle}</p><div className="fw-tag-row">{p.tags.map(t=><span key={t}>{t}</span>)}</div><footer>{p.ambassadors?<span>组织大使：{p.ambassadors.map(actorName).join('、')}</span>:<span>{jobs.length} 项正在开展的工作</span>}{pending.length>0&&<strong>{pending.length} 项待接手</strong>}</footer></button>;})}{!people.length&&<div className="fw-empty"><Icon name="people"/><h2>暂无匹配档案</h2><p>试试其他名称，或从任务看板打开关联对象。</p></div>}</div>}
    {page==='messages'&&<div className="fw-message-list">{data.messages.filter(m=>m.ownerId===actor.id).map(m=><button key={m.id} className={m.read?'read':''} onClick={()=>{onAction({type:'read',messageId:m.id});select(data.people.find(p=>p.id===m.personId)!,data.tasks.find(t=>t.id===m.taskId));}}><Icon name="bell"/><div><h2>{data.people.find(p=>p.id===m.personId)?.name}</h2><p>{m.text}</p></div><small>{m.read?'已读':'未读'}</small></button>)}{!data.messages.some(m=>m.ownerId===actor.id)&&<div className="fw-empty"><Icon name="check"/><h2>暂时没有新的提醒</h2><p>待领取的工作可以在任务看板查看。</p><Button onClick={()=>navigate('tasks')}>去看任务</Button></div>}</div>}
    {page==='statistics'&&statistics}
    {page==='tags'&&<div className="fw-people">{['person','org'].map(kind=><section className="fw-info-card" key={kind}><h2>{kind==='person'?'人物词库':'组织词库'}</h2><p>{kind==='person'?'外部人物与社员共用词义，身份变化保留标签。':'组织的特征与长期联系分别记录。'}</p><div className="fw-tag-row">{[...new Set(data.people.filter(p=>p.kind===kind).flatMap(p=>p.tags))].map(t=><span key={t}>{t}</span>)}</div></section>)}</div>}
   </main>
   {person&&<aside className="fw-detail" aria-label={`${person.name}的工作与档案`}>
    <header className="fw-detail-head"><span>工作与档案 <small>／ {person.id.toUpperCase()}</small></span><button aria-label="收起档案详情" onClick={()=>onSelect(null)}><Icon name="close"/></button></header>
    <div className="fw-detail-scroll"><div className="fw-profile"><Avatar name={person.name} org={person.kind==='org'}/><div><h2>{person.name}</h2><p>{person.member?'社员':person.relation}{person.member&&related.some(t=>t.type==='onboarding'&&t.open)&&<span> · 待入社对接</span>}</p></div><a href={'mailto:'+person.contact} aria-label={`联系${person.name}`}><Icon name="arrow"/></a></div><p className="fw-subtitle">{person.subtitle}</p>
     {person.kind==='person'&&<ol className="fw-journey" aria-label="本次入社事项">{[['引荐审核',auditDone],['确认入社',person.member],['入社对接',onboardingDone]].map(([label,done],i)=><li key={String(label)} className={done?'done':''}><span>{done?<Icon name="check" size={13}/>:i+1}</span><strong>{label}</strong><small>{done?'已完成':i===1?'明确确认':i===2&&!person.member?'入社后开展':task?.ownerId?'有人接手':'等待接续'}</small></li>)}</ol>}
     <div className="fw-next"><div><span className="fw-eyebrow">下一步</span>{task?.open&&<Status task={task}/>}</div><h3>{confirmJoin&&auditDone&&!task?.open?'确认正式入社':task?.open?task.title:person.member&&onboardingDone?'继续了解与保持联系':task&&!task.open?flowResults[task.result!]:'发起一轮引荐'}</h3><p>{task?.open?(task.ownerId?`${actorName(task.ownerId)}正在负责 · ${day(task.deadline)} 前完成`:'工作已就绪，等待成员主动领取。'):confirmJoin&&auditDone?'审核已交代；正式入社仍需明确确认。':person.member?'档案继续开启，既有工作结果和材料保留。':'查看已有材料，再决定下一步安排。'}</p></div>
     <TabList id="flow-detail" label="档案内容" value={tab} onChange={setTab} items={[{key:'overview',label:'当前工作'},{key:'notes',label:`观察记录 · ${notes.length}`},{key:'history',label:'过程与历史'}]}/>
     <section className="fw-detail-body" role="tabpanel" id="flow-detail-timeline" aria-labelledby={`flow-detail-tab-${tab}`}>
      {tab==='overview'&&<>{task&&<><section><h3>工作目的</h3><p>{task.purpose}</p></section><section><h3>交付要求</h3><p>{task.delivery}</p><button className="fw-text-button" onClick={()=>setTab('notes')}>查看档案记录 <Icon name="arrow" size={14}/></button></section>{task.noteIds.length>0&&<section><h3>已关联的结果</h3>{task.noteIds.map(id=>{const result=data.notes.find(n=>n.id===id&&n.personId===person.id);return <button className="fw-result-link" key={id} disabled={!result} onClick={()=>showNote(id)}>{result?.body.slice(0,80)??'原记录不可用'}<Icon name="arrow" size={14}/></button>;})}</section>}</>}
       <section><h3>关联工作 <small>{related.length}</small></h3>{related.map(t=><button key={t.id} className={'fw-related '+(t.id===task?.id?'selected':'')} onClick={()=>setTaskId(t.id)}><span>{t.title}</span><Status task={t}/></button>)}</section>
       {person.ambassadors&&<section><h3>组织大使</h3><p>{person.ambassadors.map(actorName).join('、')}</p></section>}
       {confirmJoin&&!(auditDone&&!task?.open)&&<section className="fw-separate-action"><Button onClick={()=>open('join')}>确认入社</Button></section>}
      </>}
      {tab==='notes'&&<><form className="fw-note-form" onSubmit={e=>{e.preventDefault();if(onAction({type:'note',personId:person.id,body:note}))setNote('');}}><label>新的观察<textarea value={note} required rows={3} onChange={e=>setNote(e.target.value)} placeholder="记录实际情况、来源与后续关注事项…"/></label><button className="fw-button fw-primary">保存到档案</button></form>{notes.map(n=><article className={'fw-note '+(targetNote===n.id?'fw-note-target':'')} key={n.id} tabIndex={-1} aria-label={`观察记录，${actorName(n.authorId)}，${fullTime(n.at)}`} ref={el=>{if(el)noteElements.current.set(n.id,el);else noteElements.current.delete(n.id);}}><header><Avatar name={actorName(n.authorId)}/><strong>{actorName(n.authorId)}</strong><time>{fullTime(n.at)}</time></header><p>{n.body}</p></article>)}{!notes.length&&<p className="fw-help">尚未留下观察。作品与动态也可以据实记录。</p>}</>}
      {tab==='history'&&<>{task?<><h3>{task.title}</h3><ol className="fw-history">{[...task.history].reverse().map(e=><li key={e.id}><i/><div><p>{e.text}</p><small>{e.actor} · {fullTime(e.at)}</small></div></li>)}</ol><h3>工作评论</h3>{task.comments.map(c=><article className="fw-comment" key={c.id}><strong>{actorName(c.authorId)}</strong><p>{c.body}</p><small>{fullTime(c.at)}</small></article>)}{task.open?<form onSubmit={e=>{e.preventDefault();if(onAction({type:'comment',taskId:task.id,body:comment}))setComment('');}}><label>补充工作说明<textarea rows={3} value={comment} required onChange={e=>setComment(e.target.value)} placeholder="讨论安排与困难；成果留在档案中"/></label><button className="fw-button">发表评论</button></form>:<p className="fw-readonly">任务已关闭，历史只读；重新开启后可继续讨论。</p>}</>:<p>发起工作后，这里会保留完整接续过程。</p>}</>}
     </section>
    </div>
    <footer className="fw-detail-actions"><div className="fw-main-action">{mainAction()}</div>{canWork&&<div className="fw-secondary-actions"><Button onClick={()=>open('release')}>放弃任务</Button><Button onClick={()=>open('extend')}>延期</Button><button className="fw-text-button" onClick={()=>open('cancel')}>取消任务</button></div>}</footer>
   </aside>}
  </div>
  {dialog&&person&&<Modal title={modalTitles[dialog.kind]} onClose={()=>setDialog(null)}><form className="fw-action-form" onSubmit={e=>{e.preventDefault();submit();}}>
   {dialog.kind==='join'?<><p>确认 <strong>{person.name}</strong> 已正式取得社员身份。</p><ul className="fw-effect-list"><li>原档案转入社员列表，资料、观察和标签全部保留。</li><li>创建一项入社对接任务，初始为待接手。</li><li>审核负责人不会自动成为对接负责人。</li></ul><p className="fw-help">确认后直接打开社员档案，继续处理下一步。</p></>:<><p>{dialog.task?.title}</p>{['release','extend','reopen'].includes(dialog.kind)?<><label>{dialog.kind==='release'?'新的接取期限':'新的任务期限'}<input type="date" required min={data.now.slice(0,10)} value={deadline} onChange={e=>setDeadline(e.target.value)}/></label><p className="fw-help">{dialog.kind==='release'?'交还后等待其他成员主动领取，不记失败。':dialog.kind==='reopen'?'保留原关闭结果。原接取者可继续，管理员为他人重开时回到待领取。':'普通评论和查看不会延长期限。'}</p></>:<><label>{dialog.kind==='complete'?'留档结果（可选）':'取消原因'}<textarea rows={5} value={text} required={dialog.kind==='cancel'} onChange={e=>setText(e.target.value)} placeholder={dialog.kind==='complete'?'结果将保存到关联档案。已留档时可直接确认完成；联系不到也可据实交代。':'说明这项工作为什么不再适用'}/></label>{dialog.kind==='complete'&&<p className="fw-help">完成由接取者确认，不强制回复或新增观察；工作结果应在档案中留存。</p>}</>}</>}
   {dialog.kind==='complete'&&notes.length>0&&<fieldset className="fw-result-picker"><legend>关联已有观察（可选）</legend><div>{notes.map(n=><div key={n.id}><label><input type="checkbox" checked={resultNotes.includes(n.id)} onChange={e=>setResultNotes(ids=>e.target.checked?[...ids,n.id]:ids.filter(id=>id!==n.id))}/><span><small>{actorName(n.authorId)} · {fullTime(n.at)}</small><span>{n.body.slice(0,180)}{n.body.length>180?'…':''}</span></span></label>{n.body.length>180&&<details><summary>展开全文</summary><p>{n.body}</p></details>}</div>)}</div></fieldset>}
   {error&&<p className="fw-error" role="alert">{error}</p>}<ModalActions><button className="fw-button fw-primary">{dialog.kind==='join'?'确认入社并查看下一步':dialog.kind==='complete'?'确认完成':dialog.kind==='release'?'确认交还':dialog.kind==='extend'?'保存新期限':dialog.kind==='reopen'?'确认重新开启':'确认取消'}</button></ModalActions>
  </form></Modal>}
 </div>;
}
