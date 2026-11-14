import { ArchiveQuickAction } from "../ArchiveQuickAction";
import { ArchiveTasks } from "../ArchiveTasks";
import { ArchiveEditButton } from "../../ui/Workspace";
import { ArchiveLifecycleNotice } from "../../ui/ArchiveLifecycle";
import { DetailFrame, EntityHeader } from "../../ui/Workspace";
import { Icon } from "../../ui/icons";
import { ArchiveRead, ArchiveReadingScope } from "../Reading";
import type { ArchiveReadDelivery } from "../../server/archive-reading";
import { isMemberArchive, archiveDisplayStatus, archivePath } from "../../rules/archive-states";
import type { ObservationFocus } from "../ObservationSection";
import { avatarUrl } from "../AvatarEditor";
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, type Member } from "../api";
import { Avatar } from "../Avatar";
import { PageError } from "../ConnectionPages";
import type { Archive } from "../../shared/archives";
import { isWorkState } from "../../rules/archive-states";
import { TagsSection } from "../TagsSection";
import { ObservationSection } from "../ObservationSection";
import { type Kind, type ArchiveWithTasks } from './types';
export function ArchiveDetail({
  onOpenTaskArchive,
  type,
  actor,
  onChanged,
  id,
  revision,
  onLoaded,
  onBack,
  onEdit,
  onState,
  notice,
  focus,
  expanded,
  onExpand,
  onNextUnread,
  onDelete
}: {
  onOpenTaskArchive: React.ComponentProps<typeof ArchiveTasks>['onOpenArchive'];
  onDelete: () => void;
  type: Kind;
  focus?: ObservationFocus;
  actor: Member;
  onChanged: () => void;
  id: string;
  revision: number;
  onLoaded: (a: Archive) => void;
  onBack?: () => void;
  onEdit: () => void;
  onState: () => void;
  notice: string;
  expanded: boolean;
  onExpand?: () => void;
  onNextUnread?: () => void;
}) {
  const [archive, setArchive] = useState<ArchiveWithTasks | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [copy, setCopy] = useState(''),
    scroll = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState<ArchiveReadDelivery | null>();
  const positionKey = `cts:${actor.id}:${id}:reading-position`;
  // A mounted detail represents one opening. Count, editor and content refreshes may
  // fetch newer data, but must never expand the original personal read snapshot.
  useEffect(() => {
    let cancelled = false;
    setError('');
    api<{
      archive: ArchiveWithTasks;
      archive_reading?: ArchiveReadDelivery | null;
    }>('/archives/' + id).then(r => {
      if (!cancelled) {
        if (['/', '/members'].includes(location.pathname) && r.archive.type === 'person' && archivePath(r.archive) !== location.pathname) {
          if (new URLSearchParams(location.search).get('archive') !== id) {
            onBack?.();
            return;
          }
          history.replaceState(null, '', archivePath(r.archive) + location.search);
          window.dispatchEvent(new window.PopStateEvent('popstate'));
        }
        setArchive(r.archive);
        setOpening(old => old === undefined ? r.archive_reading ?? null : old);
        onLoaded(r.archive);
      }
    }).catch(e => {
      if (!cancelled) {
        setArchive(null);
        setError(e.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, revision, retry]);
  useLayoutEffect(() => {
    if (archive && !focus && scroll.current) {
      try {
        scroll.current.scrollTop = Number(localStorage.getItem(positionKey) || 0);
      } catch {}
    }
  }, [archive?.id, positionKey]);
  async function copyContact(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopy('联系方式已复制');
    } catch {
      setCopy('复制未完成，请选择联系方式文字复制');
    }
  }
  return <DetailFrame sharePath={archive && !archive.deleted ? archivePath(archive) + '?archive=' + encodeURIComponent(archive.id) : undefined} label={archive && isMemberArchive(archive) ? '社员档案' : (archive?.type ?? type) === 'org' ? '组织档案' : '人物档案'} code={id.slice(0, 6).toUpperCase()} expanded={expanded} onExpand={onExpand} onClose={onBack} onNextUnread={onNextUnread} scrollRef={scroll} onScroll={e => {
    try {
      localStorage.setItem(positionKey, String(e.currentTarget.scrollTop));
    } catch {}
  }}>
  <PageError error={error} retry={() => setRetry(n => n + 1)} />{!archive && !error ? <p className="archive-list-message" role="status">正在打开档案…</p> : archive && <ArchiveReadingScope.Provider value={true}>
   {opening && !archive.deleted && <ArchiveRead delivery={opening} container={scroll} />}
   <EntityHeader name={archive.name} state={<span className={'state-badge ' + (archive.closed ? 'closed' : isWorkState(archive.type, archive.status) ? 'work' : '')}>{archiveDisplayStatus(archive)}</span>} avatar={<Avatar name={archive.name} type={archive.type} size="hero" src={avatarUrl('archive', archive.id, archive.version)} />} actions={!archive.closed && !archive.deleted && <ArchiveEditButton onClick={onEdit} />} assignment={archive.members.length > 0 && <div className="assignment-row"><div className="assigned-members">{archive.members.map(m => <span key={m.id} className="member-chip"><Avatar name={m.name} size="micro" src={avatarUrl('member', m.id, 0)} />{m.name}{m.frozen && <small>已冻结</small>}</span>)}</div></div>} contacts={<>{archive.contacts.map((c, i) => <button className="contact-pill" key={i} title={c.note || `复制${c.type}`} onClick={() => void copyContact(c.value)}><small>{c.type}</small><span>{c.value}</span><Icon name="copy" size={13} /></button>)}</>}>
    {archive.current_need && <section className="archive-current-need" aria-label={'\u5f53\u524d\u9700\u6c42'}><h2>{'\u5f53\u524d\u9700\u6c42'}</h2><p>{archive.current_need}</p></section>}
    {archive.contact_reminder?.needed && <p className="contact-reminder" role="status">{archive.contact_reminder.message}</p>}
    {archive.links.length > 0 && <ul className="archive-links">{archive.links.map((l, i) => <li key={i}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label || l.url} ↗</a></li>)}</ul>}
    {copy && <p className="form-notice" role="status">{copy}</p>}{notice && <p className="form-notice" role="status">{notice}</p>}
   </EntityHeader>
   <ArchiveLifecycleNotice deleted={archive.deleted} closed={archive.closed} onReopen={onState} onRestore={actor.role === 'admin' ? onDelete : undefined} onDelete={actor.role === 'admin' ? onDelete : undefined} />
   <TagsSection archive={archive} onChanged={onChanged} /><ArchiveQuickAction archive={archive} openTaskCount={archive.open_task_count ?? 0} onChanged={onChanged} /><ArchiveTasks key={archive.id} archiveId={archive.id} archiveVersion={archive.version} openCount={archive.open_task_count ?? 0} actor={actor} onChanged={onChanged} onOpenArchive={onOpenTaskArchive} /><ObservationSection focus={focus} actor={actor} archive={archive} onChanged={onChanged} />

  </ArchiveReadingScope.Provider>}
 </DetailFrame>;
}
