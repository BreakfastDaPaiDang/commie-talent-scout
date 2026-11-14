import { TaskLabels } from "../TaskLabels";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from "../api";
import { PageError } from "../ConnectionPages";
import { Modal, ModalActions } from "../Modal";
import { Icon } from "../../ui/icons";
import { labels, deadlineDefault, iso, purposeDefault, deliveryDefault } from './presentation';
export function CreateTask({
  onSaved
}: {
  onSaved: () => void;
}) {
  const requestedArchive = new URLSearchParams(location.search).get('create_for');
  const [followUp, setFollowUp] = useState(new URLSearchParams(location.search).get('work') !== 'specific');
  const createAttempts = useRef(new Map<string, string>());
  function clearAssociation() {
    history.replaceState(null, '', '/tasks');
    setLinkedArchive(null);
  }
  const [linkedArchive, setLinkedArchive] = useState<{
    id: string;
    name: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    if (requestedArchive) api<{
      archive: {
        id: string;
        name: string;
      };
    }>('/archives/' + requestedArchive).then(r => {
      if (active) {
        setLinkedArchive(r.archive);
        setTitle(followUp ? '联系跟进' : '具体工作');
        setPurpose(followUp ? '了解近期情况并新增观察，更新本次联系结果。' : '');
      }
    }).catch(e => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [requestedArchive]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>(['custom']);
  const [open, setOpen] = useState(!!requestedArchive),
    [priority, setPriority] = useState<'P0' | 'P1' | 'P2'>('P2'),
    [title, setTitle] = useState(labels.custom),
    [purpose, setPurpose] = useState(''),
    [delivery, setDelivery] = useState(deliveryDefault),
    [deadline, setDeadline] = useState(deadlineDefault),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [advanced, setAdvanced] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input = {
          ...(linkedArchive ? {
            archive_id: linkedArchive.id,
            follow_up: followUp
          } : {}),
          labels: selectedLabels,
          priority,
          title,
          purpose: purpose || purposeDefault,
          delivery,
          deadline_at: iso(deadline)
        },
        key = JSON.stringify(input),
        request_id = createAttempts.current.get(key) ?? crypto.randomUUID();
      createAttempts.current.set(key, request_id);
      await api('/work-tasks/create', {
        ...input,
        request_id
      });
      createAttempts.current.delete(key);
      clearAssociation();
      onSaved();
      setOpen(false);
      setTitle(labels.custom);
      setSelectedLabels(['custom']);
      setPurpose('');
      setDelivery(deliveryDefault);
      setDeadline(deadlineDefault());
      setAdvanced(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <>{<button className="button primary work-task-create-button" onClick={() => {
      setError('');
      setOpen(true);
    }}><Icon name="plus" />新建</button>}{open && <Modal title="发布任务" busy={busy} onClose={() => {
      clearAssociation();
      setOpen(false);
    }}><form className="manage-form modal-form work-task-create" onSubmit={submit}>{requestedArchive && <p className="task-defaults">关联档案：{linkedArchive?.name ?? '正在读取…'}</p>}{linkedArchive && <label>工作性质<select value={followUp ? 'followup' : 'specific'} onChange={e => setFollowUp(e.target.value === 'followup')}><option value="followup">沟通跟进</option><option value="specific">具体工作</option></select></label>}<TaskLabels value={selectedLabels} onChange={setSelectedLabels} /><label>优先级<select value={priority} onChange={e => setPriority(e.target.value as 'P0' | 'P1' | 'P2')}><option value="P0">P0 · 最高</option><option value="P1">P1 · 重要</option><option value="P2">P2 · 常规</option></select></label><label>标题<input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label><label>要处理什么<textarea required maxLength={4000} rows={4} value={purpose} placeholder={purposeDefault} onChange={e => setPurpose(e.target.value)} /></label><p className="task-defaults">默认交付：{deliveryDefault}<br />默认接取期限：7 天</p><details className="task-advanced" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>调整交付和期限</summary><label>交付要求<textarea required maxLength={4000} rows={3} value={delivery} onChange={e => setDelivery(e.target.value)} /></label><label>接取期限<input required type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} /></label></details><PageError error={error} /><ModalActions><button className="button primary" disabled={busy || !!requestedArchive && !linkedArchive}>{busy ? '正在创建…' : '发布任务'}</button></ModalActions></form></Modal>}</>;
}
