import React,{useEffect,useState} from 'react';
import {Modal,ModalActions} from './Modal';
import {remainingVoteTime} from '../shared/knowledge';
import type {KnowledgeApi,KnowledgeTagProposal} from '../shared/knowledge';
import './knowledge-tags.css';

export function KnowledgeTagProposals({api,revision,onChanged,onCount,canWrite=true,search=''}:{api:KnowledgeApi;revision:number;onChanged:()=>void;onCount?:(count:number)=>void;canWrite?:boolean;search?:string}) {
  const [rows,setRows]=useState<KnowledgeTagProposal[]>([]),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[retry,setRetry]=useState(0),[now,setNow]=useState(Date.now);
  useEffect(()=>{
    let current=true;
    setError('');
    api.read<{proposals:KnowledgeTagProposal[]}>('/tag-proposals').then(r=>{if(current)setRows(r.proposals);})
      .catch(e=>{if(current)setError(e.message);});
    return ()=>{current=false;};
  },[api,revision,retry]);
  useEffect(()=>{if(!rows.length)return;setNow(Date.now());const timer=window.setInterval(()=>setNow(Date.now()),30000);return ()=>window.clearInterval(timer);},[rows]);
  const term=search.trim().toLocaleLowerCase();
  const active=rows.filter(p=>Date.parse(p.expires_at)>now&&(p.name+' '+p.definition).toLocaleLowerCase().includes(term)),p=rows.find(p=>p.id===selected);
  useEffect(()=>{onCount?.(active.length);},[onCount,active.length]);
  async function approve(proposal:KnowledgeTagProposal) {
    setBusy(true);setError('');
    try {
      await api.write('/tag-proposals/approve',{id:proposal.id});
      setSelected('');setRetry(n=>n+1);onChanged();
    } catch(e) {setError((e as Error).message);}
    finally {setBusy(false);}
  }
  return <>
    {error&&!p&&<p role="alert" className="form-error">{error} <button className="text-button" onClick={()=>setRetry(n=>n+1)}>重试</button></p>}
    {active.length>0&&<details className="kb-tag-ballots" open={active.length<=3}>
      <summary>标签待认可 <span>{active.length}</span></summary>
      {active.map(row=><button key={row.id} type="button" onClick={()=>setSelected(row.id)}>
        <span className="kb-proposed-tag">{row.name}</span><span>{row.approved_by_me?'已认可 · ':''}{row.approval_count}/3</span>
      </button>)}
    </details>}
    {p&&<Modal title={p.pending?'认可新标签':'认可标签修改'} onClose={()=>setSelected('')} busy={busy}>
      <div className="manage-form kb-ballot-detail">
        {!p.pending&&<div><small>当前标签</small><h3>{p.current_name}</h3><p>{p.current_definition}</p></div>}
        <div><h3 className="kb-proposed-tag">{p.name}</h3>{p.definition&&<p>{p.definition}</p>}</div>
        <div className="kb-ballot-meta"><span>{p.author_name} 提出</span><span>{p.approval_count}/3 人认可</span><time dateTime={p.expires_at}>{remainingVoteTime(p.expires_at,now)}</time></div>
        {error&&<p role="alert" className="form-error">{error}</p>}
        <ModalActions>{canWrite&&<button className="button primary" disabled={busy||!!p.approved_by_me||Date.parse(p.expires_at)<=now} onClick={()=>approve(p)}>{p.approved_by_me?'已认可':'认可此标签'}</button>}</ModalActions>
      </div>
    </Modal>}
  </>;
}
