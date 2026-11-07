import React,{useRef,useState} from 'react';
import type {ExperienceSegment,OverviewResource} from '../shared/work-overview';
import type {OverviewSave} from './WorkOverview';

export function WorkOverviewPlacement({archiveId,segment,resources,save,cancel,onBusy}:{archiveId:string;segment:ExperienceSegment;resources:OverviewResource[];save:(input:OverviewSave)=>Promise<unknown>;cancel:()=>void;onBusy:(value:boolean)=>void}){
 const original=useRef(segment.placements[0]),id=useRef(original.current?.id??crypto.randomUUID());
 const [usage,setUsage]=useState(original.current?.usage??'planned'),[note,setNote]=useState(original.current?.note??''),[ids,setIds]=useState(original.current?.resource_ids??[]),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[error,setError]=useState('');
 const choices=resources.filter(r=>((r.active&&!r.deleted)||ids.includes(r.id))&&r.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);onBusy(true);setError('');try{await save({entity:'placement',id:id.current,expected_version:original.current?.version??0,archive_id:archiveId,event_id:segment.id,resource_ids:ids,note,usage});}catch(e){setLocked(!!(e as {retryOnly?:boolean}).retryOnly);setError((e as Error).message);}finally{setBusy(false);onBusy(false);}}
 return <form className="wo-placement-editor" aria-label="编辑本段落实" onSubmit={submit}>
  <fieldset disabled={busy||locked}><legend>落实情况</legend><div className="wo-status-options">{(['planned','active'] as const).map(v=><button key={v} type="button" aria-pressed={usage===v} onClick={()=>setUsage(v)}><i/>{v==='planned'?'计划使用':'已落实'}</button>)}</div>
   <label>实际行动与落实说明<textarea aria-label="实际行动与落实说明" autoFocus rows={4} maxLength={3000} value={note} onChange={e=>setNote(e.target.value)} placeholder="记录这段经历中做了什么…"/></label>
   <details className="wo-resource-select"><summary>关联资源 <span>{ids.length?`已选 ${ids.length} 项`:'可选'}</span></summary><input type="search" aria-label="搜索关联资源" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索资源"/><div className="wo-resource-options">{choices.map(r=><label key={r.id}><input type="checkbox" checked={ids.includes(r.id)} onChange={e=>setIds(old=>e.target.checked?[...old,r.id]:old.filter(id=>id!==r.id))}/><span>{r.name}{r.deleted?'（已删除）':!r.active?'（已停用）':''}</span></label>)}{!choices.length&&<p className="wo-muted">{query?'没有匹配资源':'暂无可选资源'}</p>}</div></details>
  </fieldset>
  {error&&<p className="form-error" role="alert">{error}</p>}
  <footer><button type="button" className="text-button" disabled={busy} onClick={cancel}>取消</button><button className="button primary" disabled={busy}>{busy?'保存中…':locked?'重试保存落实':'保存落实'}</button></footer>
 </form>;
}
