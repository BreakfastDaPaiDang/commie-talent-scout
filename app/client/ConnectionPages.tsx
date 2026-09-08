import React,{useContext,useEffect,useState,type FormEvent} from 'react';
import {createPortal} from 'react-dom';
import {ModalAlertTarget} from '../ui/Modal';
import {api} from './api';
import template from '../shared/bootstrap-prompt.txt?raw';

export function PageError({error,retry,retryLabel='重试'}:{error:string;retry?:()=>void;retryLabel?:string}){
  const target=useContext(ModalAlertTarget),content=error?<div className="form-error" role="alert">{error}{retry&&<button type="button" className="button quiet" onClick={retry}>{retryLabel}</button>}</div>:null;
  return target&&content?createPortal(content,target):content;
}
export function AgentPage(){
  const[copied,setCopied]=useState(false),[fallback,setFallback]=useState(false);
  const prompt=template.replace('{{MCP_SERVER_URL}}',location.origin+'/mcp').replace('{{AUTHORIZATION_GUIDE}}',location.origin+'/account/connections');
  async function copy(){try{await navigator.clipboard.writeText(prompt);setCopied(true);}catch{setFallback(true);}}
  return <main className="support-content"><section className="agent-simple"><div className="agent-copy"><span className="eyebrow">让 Agent 帮你干活</span><h1>整理资料，交给 Agent。</h1><p>让它帮你查档案、整理材料、写观察，<br/>把值得留下的信息记到这里。</p><button className="button primary" onClick={copy}>复制提示词给 Agent</button>{copied&&<p role="status">提示词已复制，粘贴给 Agent 即可。</p>}{fallback&&<div className="copy-fallback"><label>请选择下方正文复制<textarea readOnly value={prompt} onFocus={e=>e.currentTarget.select()} rows={12}/></label></div>}</div><div className="agent-art" aria-hidden="true"><img src="/art/agent-handoff-v3.png" alt=""/></div></section></main>;
}
type Connection={id:string;name:string;created_at:string;expires_at:string;revoked_at:string|null;active:number;version:number};
export function ConnectionsPage(){
  const[items,setItems]=useState<Connection[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[secret,setSecret]=useState(''),[notice,setNotice]=useState('');
  async function load(){setLoading(true);setError('');try{setItems((await api<{credentials:Connection[]}>('/connections')).credentials);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  useEffect(()=>{void load();},[]);
  async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');setSecret('');setNotice('');const form=event.currentTarget,data=new FormData(form);try{const r=await api<{secret:string}>('/connections',{name:data.get('name'),days:Number(data.get('days'))});setSecret(r.secret);form.reset();await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function revoke(item:Connection){setBusy(true);setError('');try{await api('/connections/revoke',{id:item.id});setNotice(`“${item.name}”已撤销，后续调用立即失效`);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <main className="account-content"><div className="section-title"><p className="eyebrow">猎头账号</p><h1>我的连接</h1><p>每个客户端使用独立凭证，便于识别和撤销。</p></div><PageError error={error} retry={load}/>{notice&&<p role="status" className="form-notice">{notice}</p>}
    <form className="connection-form" onSubmit={create}><label>连接名称<input name="name" required maxLength={60} placeholder="例如：我的 Codex"/></label><label>有效期<select name="days" defaultValue="90"><option value="1">1 天</option><option value="30">30 天</option><option value="90">90 天</option><option value="365">1 年</option></select></label><button className="button primary" disabled={busy}>创建凭证</button></form>
    {secret&&<section className="secret-panel"><h2>凭证只在这里显示一次</h2><p>保存到客户端支持的私有认证位置。请勿发送到聊天或提交到仓库。</p><label>个人凭证<textarea readOnly value={secret} aria-label="个人凭证" onFocus={e=>e.currentTarget.select()} rows={3}/></label><div className="inline-actions"><button className="button" onClick={async()=>{try{await navigator.clipboard.writeText(secret);setNotice('凭证已复制');}catch{setNotice('剪贴板不可用，请选择上方凭证复制');}}}>复制凭证</button><button className="button quiet" onClick={()=>setSecret('')}>我已保存，关闭显示</button></div></section>}
    {loading?<p role="status">正在读取连接…</p>:items.length===0?<p className="empty-state">还没有创建连接。</p>:<ul className="connection-list">{items.map(item=><li key={item.id}><div><strong>{item.name}</strong><span className="connection-state">{item.active?'有效':'已失效'}</span><p>到期 {new Date(item.expires_at).toLocaleDateString('zh-CN')}</p><small>连接标识：{item.id}</small></div>{!!item.active&&<button className="button quiet danger-text" disabled={busy} onClick={()=>void revoke(item)}>撤销</button>}</li>)}</ul>}
  </main>;
}
export type Call={id:string;member_id:string;credential_id:string;member_name:string|null;connection_name:string|null;tool:string;started_at:string;duration_ms:number|null;outcome:string;error_code:string|null;task_id:string|null;request_id:string|null};
export function CallDetails({id}:{id:string}){
  const[data,setData]=useState<{parameters:unknown;result:unknown;body_state:string}|null>(null),[error,setError]=useState('');
  return <details className="call-details" onToggle={e=>{if(e.currentTarget.open&&!data){setError('');api<{parameters:unknown;result:unknown;body_state:string}>('/admin/calls/'+id).then(setData).catch(e=>setError(e.message));}}}><summary>查看请求与结果</summary>{error?<p role="alert">{error}</p>:!data?<p role="status">正在读取…</p>:<><p>{data.body_state==='expired'?'正文已到期清理，保留调用信息。':data.body_state==='retained'?'已筛选的提交内容与执行摘要':'正文未完整留存'}</p>{data.parameters!==null&&<><h3>提交内容</h3><pre>{JSON.stringify(data.parameters,null,2)}</pre></>}{data.result!==null&&<><h3>执行摘要</h3><pre>{JSON.stringify(data.result,null,2)}</pre></>}</>}</details>;
}
