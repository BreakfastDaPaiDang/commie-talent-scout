import '../shared/browser-crypto';
import { PrimaryNavigation, PageRoutes } from './navigation/PageRoutes';
import { HomePage } from './HomePage';
import { KnowledgePage } from './KnowledgePage';
import { CatalogPage } from './CatalogPage';
import { MembershipNotice } from './MembershipNotice';
import { ThemePicker } from '../ui/ThemePicker';
import { LoginScene } from '../ui/LoginScene';
import { UnreadNav } from '../ui/UnreadNav';
import { TopBar, IconButton, AuxiliaryToolsNav, AgentNav } from '../ui/Workspace';
import { Icon } from '../ui/icons';
import { PasswordInput } from '../ui/PasswordInput';
import { watchSession } from './session-refresh';
import { Avatar } from './Avatar';
import { avatarUrl } from './AvatarEditor';
import { UnreadBadge } from './UnreadPage';
import './reading.css';
import { clearUploadMemory } from './Images';
import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, type Member } from './api';
import { flushDrafts, clearDraftMemory } from './draft-store';
import '../ui/app.css';
import '../ui/workspace.css';
import '../ui/brand.css';
import './production.css';
import './extensions.css';
function Brand() {
  return <a href="/" className="login-brand"><img src="/art/brand-star-v4.svg" alt="" /><span>康米巨星<small>猎头系统</small></span></a>;
}
function App() {
  const [member, setMember] = useState<Member | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginFormRevision, setLoginFormRevision] = useState(0);
  const [path, setPath] = useState(location.pathname),
    [menuOpen, setMenuOpen] = useState(false),
    [unreadCount, setUnreadCount] = useState(0);
  const [, setLocationRevision] = useState(0);
  useEffect(() => {
    const update = () => {
        setPath(location.pathname);
        setLocationRevision(v => v + 1);
      },
      expired = () => {
        clearUploadMemory();
        setMember(null);
        setNotice('登录已失效，请重新登录');
      };
    window.addEventListener('popstate', update);
    window.addEventListener('cts-session-expired', expired);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('cts-session-expired', expired);
    };
  }, []);
  function navigate(next: string) {
    setMenuOpen(false);
    history.pushState(null, '', next);
    setPath(new URL(next, location.href).pathname);
    setLocationRevision(v => v + 1);
    setError('');
    document.querySelectorAll('details[open]').forEach(x => x.removeAttribute('open'));
  }
  useEffect(() => {
    api<{
      member: Member;
    }>('/auth/me').then(x => setMember(x.member)).catch(e => {
      if (!(e instanceof ApiError && e.status === 401)) setError(e.message);
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (busy || loading) return;
    return watchSession((next, restored) => {
      if (next?.id !== member?.id) clearUploadMemory();
      if (!next) {
        if (member) setNotice('登录已失效，请重新登录');
        if (restored) setLoginFormRevision(value => value + 1);
      }
      setMember(old => old?.id === next?.id && old?.version === next?.version ? old : next);
    });
  }, [busy, loading, member?.id]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    const form = new FormData(event.currentTarget);
    setLoginUsername(String(form.get('username') ?? '').trim());
    try {
      const result = await api<{
        member: Member;
      }>('/auth/login', {
        username: form.get('username'),
        password: form.get('password')
      });
      setMember(result.member);
      if (path === '/login') navigate('/');
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'INVALID_LOGIN' ? '账号或密码不正确。若刚修改过密码，请检查自动填充内容，使用新密码；可点“显示”核对。' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const form = event.currentTarget,
      data = new FormData(form),
      username = member!.username;
    if (data.get('new_password') !== data.get('confirm_password')) {
      setError('两次输入的新密码不一致');
      return;
    }
    setBusy(true);
    let passwordSaved = false;
    try {
      await api('/auth/password', {
        current_password: data.get('current_password'),
        new_password: data.get('new_password')
      });
      passwordSaved = true;
      form.reset();
      const result = await api<{
        member: Member;
      }>('/auth/login', {
        username,
        password: data.get('new_password')
      });
      setLoginUsername(username);
      navigate('/');
      setMember(result.member);
      setNotice('密码已更新');
    } catch (e) {
      if (passwordSaved) {
        setLoginUsername(username);
        navigate('/');
        setMember(null);
        setError('密码已保存，但自动登录未完成。请使用刚设置的新密码登录。');
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      if (member) await flushDrafts(member.id);
      clearUploadMemory();
      await api('/auth/logout', {});
      if (member) clearDraftMemory(member.id);
      setMember(null);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refreshActor(message?: string) {
    try {
      const r = await api<{
        member: Member;
      }>('/auth/me');
      setMember(r.member);
      if (r.member.role !== 'admin' && path.startsWith('/admin/')) {
        navigate('/');
        setNotice(message ?? '权限已更新');
      }
      return r.member;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMember(null);
        setNotice(message ?? '登录已失效，请重新登录');
        return null;
      }
      throw e;
    }
  }
  if (loading) return <main className="initial-loading" role="status">正在打开工作台…</main>;
  const legacyArchiveLink = ['archive', 'observation', 'event'].some(key => new URLSearchParams(location.search).has(key));
  if ((path === '/home' || path === '/' && !legacyArchiveLink) && !member?.must_change_password) return <HomePage memberName={member?.name} onNavigate={navigate} />;
  if (!member && (path === '/knowledge' || path === '/catalog')) return <div className="app"><TopBar onHome={() => navigate('/')} navigation={<button className="active" onClick={() => navigate('/knowledge')}>知识库</button>} tools={<button className="tool-link" onClick={() => navigate('/')}>返回主站登录</button>} />{path === '/knowledge' ? <KnowledgePage /> : <CatalogPage />}</div>;
  if (!member || member.must_change_password || path === '/account/password') return <div className="login-page"><ThemePicker /><LoginScene /><main className="login-form"><Brand />
    {member ? <><h1 className="password-heading">{member.must_change_password ? '设置你的密码' : '修改密码'}</h1><p>{member.must_change_password ? '首次登录，请更换临时密码。' : '修改后，所有旧登录和连接会失效。'}</p><form aria-label="修改密码" onSubmit={change}>
      <input type="hidden" name="username" autoComplete="username" value={member.username} />
      <label>当前密码<PasswordInput name="current_password" autoComplete="current-password" required maxLength={128} /></label>
      <label>新密码<PasswordInput name="new_password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
      <label>再次输入新密码<PasswordInput name="confirm_password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
      <small>至少 10 个字符，可使用中文、字母、数字和符号。</small><button className="button primary" disabled={busy}>{busy ? '正在保存…' : '保存新密码'}</button>
    </form>{!member.must_change_password && <button className="button quiet" onClick={() => navigate('/')} disabled={busy}>返回工作台</button>}<button className="button quiet" onClick={logout} disabled={busy}>退出登录</button></> : <form key={loginFormRevision} aria-label="登录" onSubmit={login}><label>猎头账号<input name="username" autoComplete="username" defaultValue={loginUsername} required maxLength={80} autoFocus /></label><label>密码<PasswordInput name="password" autoComplete="current-password" required maxLength={128} /></label><button className="button primary" disabled={busy}>{busy ? '正在登录…' : '登录'}<span aria-hidden="true">→</span></button></form>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}
  </main></div>;
  const accountTools = <><button onClick={() => navigate('/account/profile')}>猎头账号</button><button onClick={() => navigate('/account/connections')}>我的连接</button><button onClick={() => navigate('/tags')}>标签库</button><button onClick={() => navigate('/statistics')}>统计仪表盘</button><button onClick={() => navigate('/tools')}>辅助工具</button><button onClick={() => navigate('/account/password')}>修改密码</button>{member.role === 'admin' && <><button onClick={() => navigate('/admin/members')}>猎头管理</button><button onClick={() => navigate('/admin/calls')}>Agent 调用</button><button onClick={() => navigate('/admin/trash')}>已删除档案</button></>}<button disabled={busy} onClick={logout}>退出登录</button></>;
  const taskReturn = new URLSearchParams(location.search),
    taskReturnId = taskReturn.get('task');
  const returnToTasks = taskReturn.get('from') === 'tasks' && taskReturnId ? () => navigate(`/tasks?task=${encodeURIComponent(taskReturnId)}`) : undefined;
  return <div className="app"><MembershipNotice key={member.id} /><TopBar onHome={() => navigate('/')} navigation={<PrimaryNavigation path={path} legacyArchiveLink={legacyArchiveLink} navigate={navigate} />} tools={<><AuxiliaryToolsNav active={path.startsWith('/tools')} onClick={() => navigate('/tools')} /><AgentNav label={path === '/knowledge' ? '智能助手接入' : undefined} active={path === '/agent'} onClick={() => navigate('/agent')} /><UnreadNav active={path === '/messages' || path === '/unread'} onClick={() => navigate('/messages')}><UnreadBadge key={member.id} onCount={setUnreadCount} /></UnreadNav>{member.role === 'admin' && <IconButton name="settings" label="猎头管理" onClick={() => navigate('/admin/members')} />}<details className="account-menu"><summary className="current-member" title="猎头账号"><Avatar name={member.name} src={avatarUrl('member', member.id, member.version)} size="tiny" /><span>{member.name}</span><Icon name="down" size={15} /></summary><div>{accountTools}</div></details></>} mobileTools={<IconButton name="menu" label="打开工具导航" onClick={() => setMenuOpen(v => !v)} />} />{menuOpen && <div className="mobile-menu"><button className="button" aria-current={path === '/messages' || path === '/unread' ? 'page' : undefined} onClick={() => navigate('/messages')}><Icon name="bell" />消息提醒{unreadCount > 0 && <span className="nav-unread">{unreadCount}</span>}</button><AgentNav label={path === '/knowledge' ? '智能助手接入' : undefined} active={path === '/agent'} onClick={() => navigate('/agent')} />{accountTools}</div>}{notice && <p className="toast" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <PageRoutes member={member} path={path} navigate={navigate} refreshActor={refreshActor} unreadCount={unreadCount} returnToTasks={returnToTasks} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
