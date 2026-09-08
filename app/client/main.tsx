import React,{useEffect,useState,type FormEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {api,ApiError,type Member} from './api';
import {AgentPage,ConnectionsPage,CallsPage} from './ConnectionPages';
import './app.css';
import './workspace.css';
import './brand.css';
import './production.css';

function Brand(){return <a href="/" className="login-brand"><img src="/art/brand-star-v4.svg" alt=""/><span>康米巨星<small>猎头系统</small></span></a>;}
function App(){
  const[member,setMember]=useState<Member|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const[path,setPath]=useState(location.pathname);
  useEffect(()=>{const update=()=>setPath(location.pathname),expired=()=>{setMember(null);setNotice('登录已失效，请重新登录');};window.addEventListener('popstate',update);window.addEventListener('cts-session-expired',expired);return()=>{window.removeEventListener('popstate',update);window.removeEventListener('cts-session-expired',expired);};},[]);
  function navigate(next:string){history.pushState(null,'',next);setPath(next);setError('');document.querySelectorAll('details[open]').forEach(x=>x.removeAttribute('open'));}
  useEffect(()=>{api<{member:Member}>('/auth/me').then(x=>setMember(x.member)).catch(e=>{if(!(e instanceof ApiError&&e.status===401))setError(e.message);}).finally(()=>setLoading(false));},[]);
  async function login(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError('');setNotice('');
    const form=new FormData(event.currentTarget);
    try{const result=await api<{member:Member}>('/auth/login',{username:form.get('username'),password:form.get('password')});setMember(result.member);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function change(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');const data=new FormData(event.currentTarget);
    if(data.get('new_password')!==data.get('confirm_password')){setError('两次输入的新密码不一致');return;}
    setBusy(true);
    try{await api('/auth/password',{current_password:data.get('current_password'),new_password:data.get('new_password')});setMember(null);setNotice('密码已更新，请使用新密码登录');}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function logout(){setBusy(true);try{await api('/auth/logout',{});setMember(null);setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  if(loading)return <main className="initial-loading" role="status">正在打开工作台…</main>;
  if(!member||member.must_change_password)return <div className="login-page"><section className="login-scene" aria-hidden="true"><img src="/art/login-observatory-v4.png" alt=""/></section><main className="login-form"><Brand/>
    {member?<><h1 className="password-heading">设置你的密码</h1><p>首次登录，请更换临时密码。</p><form aria-label="更换临时密码" onSubmit={change}>
      <label>当前临时密码<input type="password" name="current_password" autoComplete="current-password" required maxLength={128}/></label>
      <label>新密码<input type="password" name="new_password" autoComplete="new-password" minLength={12} maxLength={128} required/></label>
      <label>再次输入新密码<input type="password" name="confirm_password" autoComplete="new-password" minLength={12} maxLength={128} required/></label>
      <small>至少 12 个字符，可使用中文、字母、数字和符号。</small><button className="button primary" disabled={busy}>{busy?'正在保存…':'保存新密码'}</button>
    </form><button className="button quiet" onClick={logout} disabled={busy}>退出登录</button></>:<form aria-label="登录" onSubmit={login}><label>猎头账号<input name="username" autoComplete="username" required maxLength={80} autoFocus/></label><label>密码<input type="password" name="password" autoComplete="current-password" required maxLength={128}/></label><button className="button primary" disabled={busy}>{busy?'正在登录…':'登录'}<span aria-hidden="true">→</span></button></form>}
    {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-notice" role="status">{notice}</p>}
  </main></div>;
  return <div className="app"><header className="topbar"><Brand/><nav className="primary-nav" aria-label="主要导航"><button className={path==='/'?'active':''} onClick={()=>navigate('/')}>人物</button><button className={path==='/organizations'?'active':''} onClick={()=>navigate('/organizations')}>组织</button><button className={path==='/agent'?'active':''} onClick={()=>navigate('/agent')}>Agent 接入</button></nav><div className="topbar-tools"><details className="account-menu"><summary>{member.name}<span aria-hidden="true"> ▾</span></summary><div><button onClick={()=>navigate('/account/connections')}>我的连接</button>{member.role==='admin'&&<button onClick={()=>navigate('/admin/calls')}>Agent 调用</button>}<button disabled={busy} onClick={logout}>退出登录</button></div></details></div></header>
    {path==='/agent'?<AgentPage/>:path==='/account/connections'?<ConnectionsPage/>:path==='/admin/calls'?(member.role==='admin'?<CallsPage/>:<main className="account-content"><p role="alert">仅管理员可以查看调用记录。</p></main>):<main className="empty-workspace"><p className="eyebrow">共同观察 · 持续沉淀</p><h1>{path==='/organizations'?'组织与伙伴，':'人物与组织，'}<br/>从一条观察开始。</h1><p>目前还没有档案。</p>{error&&<p className="form-error" role="alert">{error}</p>}</main>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
