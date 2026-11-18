import { TaskLabels } from "../TaskLabels";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from "../api";
import { PageError } from "../ConnectionPages";
import { Modal, ModalActions } from "../Modal";
import { Icon } from "../../ui/icons";
import { TaskArchivePicker, type TaskArchive } from './TaskArchivePicker';
import { templateNames, taskTemplate, type TaskTemplate } from './templates';
import { deadlineDefault, iso, purposeDefault } from './presentation';
export function CreateTask({
  onSaved
}: {
  onSaved: () => void;
}) {
  const requestedArchive = new URLSearchParams(location.search).get('create_for');
  const initialType: TaskTemplate = requestedArchive && new URLSearchParams(location.search).get('work') !== 'specific' ? 'followup' : 'custom';
  const [type, setType] = useState<TaskTemplate>(initialType);
  const [copy, setCopy] = useState(() => taskTemplate(initialType));
  const [linkedArchive, setLinkedArchive] = useState<TaskArchive | null>(null);
  const [loadingArchive, setLoadingArchive] = useState(!!requestedArchive);
  const [selectedLabels, setSelectedLabels] = useState<string[]>(['custom']);
  const [open, setOpen] = useState(!!requestedArchive);
  const [priority, setPriority] = useState<'P0' | 'P1' | 'P2'>('P2');
  const [deadline, setDeadline] = useState(deadlineDefault);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const createAttempts = useRef(new Map<string, string>());
  useEffect(() => {
    if (!requestedArchive) return;
    let active = true;
    api<{archive: TaskArchive}>('/archives/' + requestedArchive).then(({archive}) => {
      if (active) setLinkedArchive(archive);
    }).catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoadingArchive(false); });
    return () => { active = false; };
  }, [requestedArchive]);
  function selectType(next: TaskTemplate) {
    const previous = taskTemplate(type, linkedArchive?.name);
    if ((Object.keys(copy) as (keyof typeof copy)[]).some(key => copy[key] !== previous[key]) &&
        !window.confirm('切换类型会替换已填写的标题、目的和交付要求。继续切换？')) return;
    setCopy(taskTemplate(next, linkedArchive?.name));
    const label = (value: TaskTemplate) => value === 'followup' ? 'custom' : value;
    setSelectedLabels(old => [...new Set([label(next), ...old.filter(key => key !== label(type))])]);
    setType(next);
  }
  function selectArchive(archive: TaskArchive | null) {
    if (copy.title === taskTemplate(type, linkedArchive?.name).title)
      setCopy(old => ({...old, title: taskTemplate(type, archive?.name).title}));
    setLinkedArchive(archive);
  }
  function close() {
    if (requestedArchive) history.replaceState(null, '', '/tasks');
    setOpen(false);
    setLinkedArchive(null);
    setLoadingArchive(false);
    setCopy(taskTemplate('custom'));
    setType('custom');
    setSelectedLabels(['custom']);
    setPriority('P2');
    setDeadline(deadlineDefault());
    setError('');
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input = {
          ...(linkedArchive ? {
            archive_id: linkedArchive.id,
            follow_up: type === 'followup'
          } : {}),
          labels: selectedLabels,
          priority,
          ...copy,
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
      close();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const needsArchive = type !== 'custom';
  return <><button className="button primary work-task-create-button" onClick={() => setOpen(true)}><Icon name="plus" />新建</button>
    {open && <Modal title="发布任务" busy={busy} onClose={close}><form className="manage-form modal-form work-task-create" onSubmit={submit}>
      <label>任务类型<select disabled={loadingArchive} value={type} onChange={e => selectType(e.target.value as TaskTemplate)}>
        {Object.entries(templateNames).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select></label>
      {loadingArchive ? <p role="status">正在读取关联档案…</p> : <TaskArchivePicker value={linkedArchive} onChange={selectArchive} />}
      <label>标题<input required maxLength={160} value={copy.title} onChange={e => setCopy({...copy, title: e.target.value})}/></label>
      <label>要处理什么<textarea required maxLength={4000} rows={4} value={copy.purpose} placeholder={purposeDefault} onChange={e => setCopy({...copy, purpose: e.target.value})}/></label>
      <label>交付要求<textarea required maxLength={4000} rows={3} value={copy.delivery} onChange={e => setCopy({...copy, delivery: e.target.value})}/></label>
      <TaskLabels value={selectedLabels} onChange={setSelectedLabels}/>
      <label>优先级<select value={priority} onChange={e => setPriority(e.target.value as typeof priority)}>
        <option value="P0">P0 · 最高</option><option value="P1">P1 · 重要</option><option value="P2">P2 · 常规</option>
      </select></label>
      <details className="task-advanced"><summary>调整接取期限</summary><label>接取期限<input required type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)}/></label></details>
      <PageError error={error}/>{needsArchive && !linkedArchive && !loadingArchive && <small>请先选择相关对象</small>}
      <ModalActions><button className="button primary" disabled={busy || loadingArchive || (needsArchive || !!requestedArchive) && !linkedArchive}>{busy ? '正在创建…' : '发布任务'}</button></ModalActions>
    </form></Modal>}
  </>;
}
