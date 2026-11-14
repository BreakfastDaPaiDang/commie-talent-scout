import { ArchiveDeletionConfirmation } from "../../ui/ArchiveLifecycle";
import { ProfileFields } from "../../ui/ArchiveFields";
import { archiveDisplayStatus } from "../../rules/archive-states";
import { useEffect, useState, type FormEvent } from 'react';
import { api } from "../api";
import { ModalActions } from "../Modal";
import { PageError } from "../ConnectionPages";
import type { Archive, BoundMember } from "../../shared/archives";
import { StateFields } from "../ArchiveStateForm";
import { isWorkState } from "../../rules/archive-states";
import { contactReminder } from "../../rules/contact-reminders";
import { type Kind } from './types';
export function ArchiveDeletionDialog({
  archive,
  busy,
  setBusy,
  onCancel,
  onSaved,
  onReload
}: {
  archive: Archive;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onCancel: () => void;
  onSaved: () => void;
  onReload: () => Promise<void>;
}) {
  const [requestId] = useState(() => crypto.randomUUID()),
    [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api(archive.deleted ? '/archives/restore' : '/archives/delete', {
        id: archive.id,
        expected_version: archive.version,
        request_id: requestId
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <ArchiveDeletionConfirmation name={archive.name} status={archiveDisplayStatus(archive)} deleted={archive.deleted} busy={busy} error={error} onCancel={onCancel} onConfirm={() => void submit()} onReload={() => void onReload().catch(e => setError(e.message))} />;
}
export function ArchiveForm({
  type,
  initial,
  createStatus,
  busy,
  setBusy,
  onSaved,
  onReload
}: {
  type: Kind;
  initial?: Archive;
  createStatus?: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onSaved: (id: string, changed: boolean) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? ''),
    [currentNeed, setCurrentNeed] = useState(initial?.current_need ?? ''),
    [contacts, setContacts] = useState(initial?.contacts ?? []),
    [links, setLinks] = useState(initial?.links ?? []),
    [error, setError] = useState(''),
    [requestId] = useState(() => crypto.randomUUID()),
    [similar, setSimilar] = useState<Archive[]>([]),
    [status, setStatus] = useState(createStatus ?? '视奸观察'),
    [members, setMembers] = useState<BoundMember[]>([]);
  useEffect(() => {
    if (initial || !name.trim()) {
      setSimilar([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api<{
        archives: Archive[];
      }>('/archives?' + new URLSearchParams({
        type,
        query: name,
        limit: '3'
      })).then(r => {
        if (!cancelled) setSimilar(r.archives);
      }).catch(() => {});
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, initial, type]);
  const reminder = contactReminder(type, initial?.status ?? status, contacts);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{
        id: string;
        changed: boolean;
      }>(initial ? '/archives/update' : '/archives/create', {
        ...(initial ? {
          id: initial.id,
          expected_version: initial.version
        } : {
          type
        }),
        name,
        current_need: currentNeed,
        contacts,
        links,
        ...(!initial ? {
          status,
          member_ids: members.map(m => m.id)
        } : {}),
        request_id: requestId
      });
      await onSaved(r.id, r.changed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <form className="manage-form archive-form" onSubmit={save}>
  {reminder.needed && <p className="contact-reminder" role="status">{reminder.message}</p>}
  <ProfileFields type={type} nameManaged={!!initial?.linked_account_id} name={name} setName={setName} currentNeed={currentNeed} setCurrentNeed={setCurrentNeed} contacts={contacts} setContacts={setContacts} links={links} setLinks={setLinks}>{similar.length > 0 && <p className="similar-archives">已有相似档案：{similar.map(a => a.name).join('、')}。同名不同对象可以继续创建。</p>}</ProfileFields>
   {!initial && createStatus ? <p className="archive-readonly">身份：社员。新建后保持开启，并沿用同一人物档案。</p> : !initial && <StateFields type={type} status={status} onStatus={s => {
      setStatus(s);
      setMembers([]);
    }} members={members} onMembers={setMembers} />}
  <PageError error={error} retry={initial ? () => void onReload().catch(e => setError(e.message)) : undefined} retryLabel="重新读取并替换表单" /><ModalActions><button className="button primary" disabled={busy || !initial && isWorkState(type, status) && members.length === 0}>{busy ? '正在保存…' : initial ? '保存资料' : '创建档案'}</button></ModalActions>
 </form>;
}
