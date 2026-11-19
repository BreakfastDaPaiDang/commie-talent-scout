import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { KnowledgeActivity, KnowledgeActivityPage, KnowledgeApi, KnowledgeDocumentTarget, KnowledgeIdentity } from '../shared/knowledge';
import { ActivityComment, ActivityCommentEntry, ActivityComposer, ActivityEvent, ActivityHeading, ActivityTimeline } from './ActivityTimeline';
import { Avatar } from './Avatar';
import { KnowledgeVersionModal, type VersionTarget } from './KnowledgeHistoryDetails';
import { RecordBody } from './Workspace';
import { Icon } from './icons';
import './knowledge-activity.css';

const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', hour12: false,
  year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
const memberId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function KnowledgeAvatar({id, name, identity, size = 'micro'}: {
  id: string; name: string; identity?: KnowledgeIdentity; size?: string;
}) {
  const src = identity?.kind === 'member' && memberId.test(id)
    ? '/avatars/members/' + encodeURIComponent(id) : undefined;
  return <Avatar name={name} src={src} size={size} />;
}

function ActivityTime({at}: {at: string}) {
  return <time dateTime={at}>{timeFormat.format(new Date(at))}</time>;
}

function DocumentCommentComposer({api, target, onSaved, placeholder, parentId, onCancel}: {
  api: KnowledgeApi;
  target: KnowledgeDocumentTarget;
  onSaved: () => void;
  placeholder: string;
  parentId?: string;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const launch = useRef<HTMLButtonElement>(null);
  const expanded = !!(parentId || focused || body || busy || error);
  useEffect(() => { if (parentId) input.current?.focus(); }, [parentId]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.write('/comments', {...target, ...(parentId ? {parent_id: parentId} : {}), body: body.trim()});
      setBody('');
      setFocused(false);
      launch.current?.focus();
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <ActivityComposer onSubmit={submit} className={expanded ? undefined : 'kb-activity-composer-collapsed'}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}
    leading={parentId ? undefined : <button ref={launch} type="button" className="kb-activity-compose-launch"
      aria-label="撰写评论" aria-expanded={expanded} onClick={() => input.current?.focus()}><Icon name="plus" /></button>}
  >
    <textarea ref={input} aria-label={placeholder} placeholder={placeholder} rows={expanded ? 2 : 1} maxLength={8000}
      onFocus={() => setFocused(true)}
      value={body} onChange={event => setBody(event.target.value)} readOnly={busy} required
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape' && onCancel && !busy) onCancel();
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      }}
    />
    {expanded && <div className="kb-activity-composer-actions">
      {onCancel && <button type="button" className="button quiet" onClick={onCancel} disabled={busy}>取消</button>}
      <button type="submit" className="button primary" disabled={busy || !body.trim()}>{busy ? '发送中…' : '发送'}</button>
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </ActivityComposer>;
}

function TimelineComment({entry, api, target, identity, writable, onSaved}: {
  entry: Extract<KnowledgeActivity, {kind: 'comment'}>;
  api: KnowledgeApi;
  target: KnowledgeDocumentTarget;
  identity: KnowledgeIdentity;
  writable: boolean;
  onSaved: () => void;
}) {
  const [reply, setReply] = useState(false);
  const replyButton = useRef<HTMLButtonElement>(null);
  const name = entry.author_name || '成员';
  function closeReply() {
    setReply(false);
    replyButton.current?.focus();
  }
  return <ActivityCommentEntry>
    <ActivityComment avatar={<KnowledgeAvatar id={entry.author_id} name={name} identity={identity} />}
      author={name} time={<ActivityTime at={entry.created_at} />}
      actions={writable && <button ref={replyButton} type="button" className="text-button" aria-expanded={reply}
        onClick={() => setReply(value => !value)}>回复</button>}
      composer={writable && reply && <DocumentCommentComposer api={api} target={target} parentId={entry.comment_id}
        placeholder={'回复 ' + name + '…'} onCancel={closeReply} onSaved={() => {closeReply(); onSaved();}} />}
    >
      {entry.parent_author_name && <small className="kb-activity-reply-to">回复 {entry.parent_author_name}</small>}
      <RecordBody body={entry.body} />
    </ActivityComment>
  </ActivityCommentEntry>;
}

const labels = {commit: '提交版本', submission: '提交审核', approval: '已认可此版本', merge: '合入知识库'};
const emptyPage: KnowledgeActivityPage = {entries: [], next_cursor: null};

export function KnowledgeDocumentActivity({api, target, identity, writable, revision, children}: {
  api: KnowledgeApi;
  target: KnowledgeDocumentTarget;
  identity: KnowledgeIdentity;
  writable: boolean;
  revision?: number;
  children?: ReactNode;
}) {
  const query = new URLSearchParams(target).toString();
  const path = '/activity?' + query;
  const [state, setState] = useState<{path: string; page: KnowledgeActivityPage}>({path, page: emptyPage});
  const page = state.path === path ? state.page : emptyPage;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [version, setVersion] = useState<VersionTarget | null>(null);
  const request = useRef(0);
  useEffect(() => {
    const id = ++request.current;
    setError('');
    setLoading(true);
    api.read<KnowledgeActivityPage>(path).then(page => {
      if (id === request.current) setState({path, page});
    }).catch(error => {
      if (id === request.current) setError(error.message);
    }).finally(() => {
      if (id === request.current) setLoading(false);
    });
    return () => { request.current++; };
  }, [api, path, revision, reload]);

  async function loadMore() {
    if (loading || !page.next_cursor) return;
    const id = ++request.current;
    setError('');
    setLoading(true);
    try {
      const more = await api.read<KnowledgeActivityPage>(path + '&cursor=' + encodeURIComponent(page.next_cursor));
      if (id === request.current) {
        setState(old => ({path, page: {entries: [...old.page.entries, ...more.entries], next_cursor: more.next_cursor}}));
      }
    } catch (error) {
      if (id === request.current) setError((error as Error).message);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  function refresh() { setReload(value => value + 1); }
  return <section className="kb-document-comments kb-document-activity" aria-label="评论与历史">
    <ActivityHeading as="h2" />
    {writable && <DocumentCommentComposer api={api} target={target} onSaved={refresh}
      placeholder="写下对这篇文档的评论…" />}
    {error && <p className="form-error" role="alert">{error} <button type="button" className="text-button" onClick={refresh}>重试</button></p>}
    {!page.entries.length ? (!error && <p className="task-history-loading" role="status">
      {loading ? '正在读取评论与历史…' : '还没有评论与历史'}
    </p>) : <ActivityTimeline>
      {page.entries.map(entry => entry.kind === 'comment'
        ? <TimelineComment key={entry.id} entry={entry} api={api} target={target} identity={identity} writable={writable} onSaved={refresh} />
        : <ActivityEvent key={entry.id} label={labels[entry.kind]} byline={
          <span className="kb-activity-byline">
            <KnowledgeAvatar id={entry.author_id} name={entry.author_name || '成员'} identity={identity} />
            <span>{entry.author_name || '成员'}</span><ActivityTime at={entry.created_at} />
          </span>
        }>
          {entry.body && entry.body !== labels[entry.kind] && <small className="kb-activity-message">{entry.body}</small>}
          {entry.commit_id && <button type="button" className="text-button" onClick={() => setVersion({
            commitId: entry.commit_id!, branchId: entry.commit_branch_id ?? target.branch_id, documentId: target.document_id,
          })}>查看版本</button>}
        </ActivityEvent>)}
    </ActivityTimeline>}
    {page.next_cursor && <button type="button" className="button outline" disabled={loading} onClick={loadMore}>
      {loading ? '正在加载…' : '加载更早记录'}
    </button>}
    {children}
    {version && <KnowledgeVersionModal api={api} target={version} close={() => setVersion(null)} />}
  </section>;
}
