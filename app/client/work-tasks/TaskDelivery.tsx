import type { MembershipResult } from "../../shared/feishu-invitation";
import { observationRequiredMessage, personnelDeliveryKind } from "../../rules/task-delivery";
import { TaskCompletionChoice } from "../../ui/TaskCompletionChoice";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { TaskObservationComposer, type TaskObservation } from "../TaskObservationComposer";
import { api } from "../api";
import { PageError } from "../ConnectionPages";
import { ObservationReferenceOption } from "../../ui/TaskBook";
import { type Task } from '../../shared/work-tasks';
import { deadlineDefault, iso, displayDate } from './presentation';
export type ObservationOption = {
  id: string;
  content_version: number;
  author_name: string;
  created_at: string;
  body: string;
  deleted: boolean;
};
export function CompleteForm({
  task,
  onSaved,
  onBusyChange
}: {
  task: Task;
  onSaved: (result: MembershipResult, requestId: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [kind, setKind] = useState(personnelDeliveryKind(task) ? '' : 'completed'),
    [text, setText] = useState(''),
    [references, setReferences] = useState<{
      observation_id: string;
      content_version: number;
    }[]>([]),
    [observations, setObservations] = useState<ObservationOption[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loadingReferences, setLoadingReferences] = useState(false),
    [error, setError] = useState(''),
    [referenceError, setReferenceError] = useState(''),
    [busy, setBusy] = useState(false);
  const [nextContact, setNextContact] = useState(deadlineDefault);
  const attempts = useRef(new Map<string, string>());
  const continuing = !!task.requires_observation_reference && kind === 'unable_to_contact';
  const createdObservations = useRef<TaskObservation[]>([]),
    referenceSequence = useRef(0),
    [savingObservation, setSavingObservation] = useState(false);
  function observationCreated(observation: TaskObservation) {
    createdObservations.current = [observation, ...createdObservations.current.filter(o => o.id !== observation.id)];
    setObservations(old => [observation, ...old.filter(o => o.id !== observation.id)]);
    setReferences(old => [...old.filter(r => r.observation_id !== observation.id), {
      observation_id: observation.id,
      content_version: observation.content_version
    }]);
    setError('');
  }
  async function loadReferences(before?: string) {
    if (!task.archive_id) return;
    const sequence = ++referenceSequence.current;
    setLoadingReferences(true);
    setReferenceError('');
    try {
      const r = await api<{
        observations: ObservationOption[];
        next_cursor: string | null;
      }>('/observations?' + new URLSearchParams({
        archive_id: task.archive_id,
        deleted: 'false',
        limit: '20',
        ...(before ? {
          before
        } : {})
      }));
      if (sequence !== referenceSequence.current) return;
      setObservations(old => [...new Map((before ? [...old, ...r.observations] : [...createdObservations.current, ...r.observations]).filter(o => !o.deleted && (!task.requires_observation_reference || o.created_at >= (task.round_started_at ?? task.created_at))).map(o => [o.id, o])).values()]);
      setCursor(r.next_cursor);
    } catch (e) {
      if (sequence === referenceSequence.current) setReferenceError((e as Error).message);
    } finally {
      if (sequence === referenceSequence.current) setLoadingReferences(false);
    }
  }
  useEffect(() => {
    createdObservations.current = [];
    setObservations([]);
    setCursor(null);
    void loadReferences();
    return () => {
      referenceSequence.current++;
    };
  }, [task.archive_id]);
  function toggleReference(observation: ObservationOption) {
    setError(current => current === observationRequiredMessage ? '' : current);
    setReferences(current => current.some(ref => ref.observation_id === observation.id) ? current.filter(ref => ref.observation_id !== observation.id) : [...current, {
      observation_id: observation.id,
      content_version: observation.content_version
    }]);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || savingObservation) return;
    if (!kind) {
      setError('请选择交付结论');
      return;
    }
    if (task.requires_observation_reference && !references.length) {
      setError(observationRequiredMessage);
      return;
    }
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      const input = {
          id: task.id,
          expected_version: task.version,
          result_kind: kind,
          result_text: text,
          references,
          ...(continuing ? {
            next_contact_at: iso(nextContact)
          } : {})
        },
        key = JSON.stringify(input),
        request_id = attempts.current.get(key) ?? crypto.randomUUID();
      attempts.current.set(key, request_id);
      let result: MembershipResult;
      try {
        result = await api<MembershipResult>('/work-tasks/complete', {
          ...input,
          request_id
        });
      } catch (error) {
        const receipt = await api<{
          status: string;
          result: MembershipResult;
        }>('/commands/' + request_id).catch(() => null);
        if (receipt?.status !== 'completed') throw error;
        result = receipt.result;
      }
      attempts.current.delete(key);
      onSaved(result, request_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return <form className="work-task-result" onSubmit={submit}><TaskCompletionChoice task={task} value={kind} onChange={value => {
      setKind(value);
      setError('');
    }} />{task.archive_id && <TaskObservationComposer disabled={busy} key={task.archive_id} archiveId={task.archive_id} initialBody={text} onCreated={observationCreated} onBusyChange={value => {
      setSavingObservation(value);
      onBusyChange(value);
    }} />}<label>结果说明<textarea required rows={3} maxLength={5000} value={text} onChange={e => setText(e.target.value)} placeholder="如实交代做了什么、结果是什么、还需要什么" /></label>{task.archive_id && <fieldset className="task-result-references"><legend>引用已有观察（{task.requires_observation_reference ? '必选' : '可选'}）</legend><p className="task-reference-selection" role="status">已选 {references.length} 条</p>{loadingReferences && !observations.length ? <p className="history-loading">正在读取观察…</p> : observations.length ? observations.map(observation => <ObservationReferenceOption key={observation.id} id={observation.id} author={observation.author_name} time={displayDate(observation.created_at)} preview={observation.body ? observation.body.slice(0, 160) + (observation.body.length > 160 ? '…' : '') : '（图片观察）'} checked={references.some(ref => ref.observation_id === observation.id)} onChange={() => toggleReference(observation)} />) : <p className="history-loading">暂无可引用的观察</p>}{referenceError && <PageError error={referenceError} retry={() => void loadReferences(cursor ?? undefined)} />} {loadingReferences && observations.length > 0 && <p className="history-loading">正在读取更多观察…</p>}{!loadingReferences && cursor && <button type="button" className="text-button" onClick={() => void loadReferences(cursor)}>加载更早观察</button>}</fieldset>}{continuing && <label>下一次联系时间<input type="datetime-local" required value={nextContact} onChange={e => setNextContact(e.target.value)} /></label>}<PageError error={error} /><button className="button primary" disabled={busy || savingObservation}>{busy ? '正在提交…' : continuing ? '记录尝试并继续跟进' : '提交结果并结束任务'}</button></form>;
}
