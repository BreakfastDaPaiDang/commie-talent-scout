import React, {useRef, useState} from 'react';
import {memberBasicStates, type MemberBasicState} from '../rules/archive-states';

type Input = {name:string; qq:string; basis:string; member_status:MemberBasicState; request_id:string};
type Result = {id:string; changed:boolean};

export function MemberBackfill({save,openArchive}: {save:(input:Input)=>Promise<Result>; openArchive:(id:string)=>void}) {
  const [name,setName] = useState(''), [qq,setQQ] = useState(''), [basis,setBasis] = useState('');
  const [status,setStatus] = useState<MemberBasicState>('可接工作');
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const [result,setResult] = useState<Result|null>(null);
  const request = useRef<{key:string; id:string}|null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const fields = {name:name.trim(),qq:qq.trim(),basis:basis.trim(),member_status:status};
    const key = JSON.stringify(fields);
    if (request.current?.key !== key) request.current = {key,id:crypto.randomUUID()};
    setBusy(true); setError('');
    try { setResult(await save({...fields,request_id:request.current.id})); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '补录失败，请重试'); }
    finally { setBusy(false); }
  }
  return <main className="account-content">
    <div className="section-title"><h1>补录历史社员</h1><p>为已经入社、遗漏登记的社员补建档案。系统会按 QQ 核对已有档案。</p></div>
    {result ? <section className="manage-form">
      <p role="status">{result.changed ? '已补录「'+name.trim()+'」，入社依据已保存到观察记录。' : '「'+name.trim()+'」已经有正式社员档案。'}</p>
      <button className="button primary" onClick={()=>openArchive(result.id)}>查看社员档案</button>
    </section> : <form className="manage-form" onSubmit={submit}>
      <label>社员名称<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>
      <label>QQ<input required inputMode="numeric" pattern="[0-9]{5,20}" maxLength={20} value={qq} onChange={e=>setQQ(e.target.value)} disabled={busy}/></label>
      <label>基本状态<select value={status} onChange={e=>setStatus(e.target.value as MemberBasicState)} disabled={busy}>{memberBasicStates.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>原入社依据<textarea required rows={5} maxLength={100000} value={basis} onChange={e=>setBasis(e.target.value)} disabled={busy} placeholder="当时如何确认入社或完成对接？这段内容会写入档案观察。"/></label>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button className="button primary" disabled={busy || !name.trim() || !basis.trim() || !/^\d{5,20}$/.test(qq)}>{busy?'正在补录…':'确认补录'}</button>
    </form>}
  </main>;
}
