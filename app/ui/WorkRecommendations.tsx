import React,{useEffect,useState} from 'react';
import type {RecommendationAPI,RecommendationData,WorkRecommendation,RecommendationAcceptance,RecommendationEvidence} from '../shared/work-recommendations';
import type {OverviewPerson} from '../shared/work-overview';

const kinds={resource:'资源',person:'协助人',task:'可参与的任务'};
const localDate=(date:Date)=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
export function WorkRecommendations({person,api,revision,openTask,onBusy,onDirty,refresh}:{person:OverviewPerson;api:RecommendationAPI;revision:string;openTask:(id:string)=>void;onBusy:(busy:boolean)=>void;onDirty:(dirty:boolean)=>void;refresh:()=>void}){
 const [data,setData]=useState<RecommendationData|null>(null),[source,setSource]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[reload,setReload]=useState(0),[filter,setFilter]=useState('all');
 const [basis,setBasis]=useState<RecommendationEvidence|null>(null),[selected,setSelected]=useState<WorkRecommendation|null>(null),[title,setTitle]=useState(''),[purpose,setPurpose]=useState(''),[owner,setOwner]=useState(''),[deadline,setDeadline]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState<RecommendationAcceptance|null>(null),[created,setCreated]=useState<{id:string;reused?:boolean}|null>(null);
 const observations=person.segments.flatMap(s=>s.observations).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 useEffect(()=>{let active=true;setLoading(true);setError('');api.load(person.id,source||undefined).then(d=>{if(active)setData(d);}).catch(e=>{if(active){setData(null);setError(e.message);}}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[api,person.id,source,revision,reload]);
 useEffect(()=>{onDirty(!!selected);return()=>onDirty(false);},[selected,onDirty]);
 function choose(candidate:WorkRecommendation){setSelected(candidate);setBasis(data!.evidence);setTitle(`协助${person.name}对接${candidate.name}`);setPurpose(`联系并确认${candidate.name}是否适合，协调一次实际对接。`);setDeadline(localDate(new Date(Date.now()+7*86400000)));const current=person.tasks.find(t=>t.follow_up!==false&&t.owner_name===person.owner_name)?.owner_id;setOwner(data!.assignees.some(a=>a.id===current)?current!:data!.actor_id);setError('');setCreated(null);}
 async function accept(){
  if(!selected||!basis)return;
  const input=attempt??{archive_id:person.id,title,purpose,delivery:'新增观察，记录本人意愿、接收方确认情况、实际对接结果及后续约定。',deadline_at:new Date(deadline).toISOString(),handoff:{observation_id:basis.id,content_version:basis.content_version,target_kind:selected.kind,target_id:selected.id,target_version:selected.version,owner_id:owner}};
  setBusy(true);onBusy(true);setError('');setAttempt(input);
  let unresolved=false;
  try{const result=await api.accept(input);setCreated(result);setSelected(null);setAttempt(null);setReload(v=>v+1);refresh();}
  catch(e){setError((e as Error).message);unresolved=!!(e as {retryOnly?:boolean}).retryOnly;if(!unresolved)setAttempt(null);}
  finally{setBusy(false);onBusy(unresolved);}
 }
 return <section className="wo-recommendations" aria-label="推荐对接">
  <div className="wo-section-title"><h3>推荐对接</h3><button className="text-button" disabled={busy||!!attempt} onClick={()=>setReload(v=>v+1)}>刷新</button></div>
  {loading?<p className="wo-muted" role="status">正在匹配观察与候选…</p>:data&&!selected&&<>
   {data.evidence?<>
    <label className="wo-evidence-choice">依据<select aria-label="推荐依据" value={source} onChange={e=>{setSource(e.target.value);setCreated(null);}}><option value="">最新观察</option>{observations.map(o=><option key={o.id} value={o.id}>{new Date(o.created_at).toLocaleDateString('zh-CN')} · {o.body.slice(0,28)}</option>)}</select></label>
    <details className="wo-recommendation-evidence"><summary>查看依据 · {new Date(data.evidence.created_at).toLocaleDateString('zh-CN')}</summary><p>{data.evidence.body||'此观察只有图片，暂无可匹配文字。'}</p></details>
    <div className="wo-candidate-tabs" aria-label="候选类型">{(['all','resource','person','task'] as const).map(k=><button key={k} aria-pressed={filter===k} onClick={()=>setFilter(k)}>{k==='all'?'全部':kinds[k]}</button>)}</div>
    <p className="wo-muted">按共同主题提供候选，意愿与接收条件待确认。</p>
    <div className="wo-candidate-list">{data.candidates.filter(c=>filter==='all'||c.kind===filter).map(c=>{const existing=data.accepted.find(a=>a.observation_id===data.evidence!.id&&a.target_kind===c.kind&&a.target_id===c.id&&a.content_version===data.evidence!.content_version);return <article className="wo-candidate" key={c.kind+c.id}><div className="wo-section-title"><b>{c.name}</b><span>{kinds[c.kind]}</span></div><p>{c.reason}</p><details><summary>条件与资料</summary><p>{c.text}</p><ul>{c.conditions.map(condition=><li key={condition}>{condition}</li>)}</ul></details>{existing?<button className="text-button" onClick={()=>openTask(existing.task_id)}>查看已采纳任务 →</button>:<button className="text-button" onClick={()=>choose(c)}>安排对接 →</button>}</article>;})}</div>
    {!data.candidates.some(c=>filter==='all'||c.kind===filter)&&<p className="wo-muted">暂无有依据的候选。可补充观察中的具体事情，或资源说明与人物标签。</p>}
   </>:<p className="wo-muted">先记录一次近况，再匹配合适的事情、人和资源。</p>}
  </>}
  {selected&&data?.evidence&&<form className="wo-handoff-form" aria-label="安排对接" onSubmit={e=>{e.preventDefault();void accept();}}><fieldset disabled={busy||!!attempt}><legend>{selected.name}</legend><p>{selected.reason}</p><label>任务标题<input required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>要做什么<textarea aria-label="要做什么" required rows={3} maxLength={4000} value={purpose} onChange={e=>setPurpose(e.target.value)}/></label><div className="wo-handoff-fields"><label>负责人<select required value={owner} onChange={e=>setOwner(e.target.value)}>{data.assignees.map(m=><option value={m.id} key={m.id}>{m.name}</option>)}</select></label><label>截止时间<input required type="datetime-local" value={deadline} onChange={e=>setDeadline(e.target.value)}/></label></div><p className="wo-muted">交付：新增观察，记录意愿、接收确认和实际结果。</p></fieldset><footer><button type="button" className="text-button" disabled={busy||!!attempt} onClick={()=>setSelected(null)}>取消</button><button className="button primary" disabled={busy||loading}>{busy?'保存中…':attempt?'重试原操作':'确认并创建任务'}</button></footer></form>}
  {created&&<p role="status">{created.reused?'已关联已有任务':'已创建对接任务'} <button className="text-button" onClick={()=>openTask(created.id)}>打开任务 →</button></p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  {!!data?.accepted.length&&!selected&&<details className="wo-accepted"><summary>对接进展 · {data.accepted.length}</summary>{data.accepted.map(t=><button className="wo-task" key={t.task_id} onClick={()=>openTask(t.task_id)}><b>{t.title}</b><span>{t.owner_name??'待分派'} · {t.status==='open'?'跟进中':t.status==='completed'?'已完成':'已关闭'}</span>{t.result_text&&<small>{t.result_text}</small>}</button>)}</details>}
 </section>;
}
