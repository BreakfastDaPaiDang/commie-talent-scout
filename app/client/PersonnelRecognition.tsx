import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { Modal, ModalActions } from './Modal';
import { PageError } from './ConnectionPages';
import { RecognitionProgress, RecognitionButton, RecognitionConfirmation } from '../ui/PersonnelRecognition';
import type { Archive } from '../shared/archives';
import type { Observation } from '../server/observations';
type Vote = {
  id: string;
  name: string;
  observation_id: string;
  content_version: number;
  withdrawn_at: string | null;
  evidence_deleted: number;
};
type Summary = {
  archive_name: string;
  round_number: number;
  round: {
    state: string;
  } | null;
  count: number;
  required: number;
  can_recognize: boolean;
  quota: {
    remaining: number;
    limit: number;
  };
  mine: Vote | null;
  votes: Vote[];
  task_id: string | null;
};
type Context = {
  summary: Summary | null;
  select: (o: Observation) => void;
};
const RecognitionContext = createContext<Context | null>(null);
export function PersonnelRecognitionScope({
  archive,
  onChanged,
  children
}: {
  archive: Archive;
  onChanged: () => void;
  children: React.ReactNode;
}) {
  const [summary, setSummary] = useState<Summary | null>(null),
    [selected, setSelected] = useState<Observation | null>(null),
    [withdrawing, setWithdrawing] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [requestId, setRequestId] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false;
    setError('');
    if (archive.type !== 'person') return;
    api<Summary>('/personnel-recognition/' + archive.id).then(r => {
      if (!stopped) setSummary(r);
    }).catch(e => {
      if (!stopped) setError(e.message);
    });
    return () => {
      stopped = true;
    };
  }, [archive.id, archive.version, retry]);
  const select = (observation: Observation) => {
    setSelected(observation);
    setWithdrawing(false);
    setRequestId(crypto.randomUUID());
    setError('');
  };
  async function submit() {
    if (!summary) return;
    setBusy(true);
    setError('');
    try {
      if (withdrawing && summary.mine) await api('/personnel-recognition/withdraw', {
        id: summary.mine.id,
        request_id: requestId
      });else if (selected) await api('/personnel-recognition/recognize', {
        archive_id: archive.id,
        round_number: summary.round_number,
        observation_id: selected.id,
        content_version: selected.content_version,
        request_id: requestId
      });
      setSelected(null);
      setWithdrawing(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <RecognitionContext.Provider value={{
    summary,
    select
  }}>{archive.type === 'person' && archive.person_role !== 'member' && !archive.deleted && <>
    <PageError error={!selected && !withdrawing ? error : ''} retry={() => setRetry(n => n + 1)} />
    {summary && <RecognitionProgress count={summary.count} required={summary.required} previousRound={summary.round?.state === 'closed'}
      taskHref={summary.task_id ? '/tasks?task=' + summary.task_id : undefined}>
      {summary.votes.length > 0 && <ul className="recognition-votes">{summary.votes.map(v => <li key={v.id}>
        <strong>{v.name}</strong>
        {v.evidence_deleted ? <span>依据已删除</span> :
          <a href={'/people?archive=' + archive.id + '&observation=' + v.observation_id + '&version=' + v.content_version}>查看依据 <span>· 版本 {v.content_version}</span></a>}
        {v.withdrawn_at && <span>已撤回</span>}
        {v.id === summary.mine?.id && !v.withdrawn_at && !archive.closed &&
          <button className="text-button" onClick={() => {
            setWithdrawing(true);
            setRequestId(crypto.randomUUID());
            setError('');
          }}>撤回认可</button>}
      </li>)}</ul>}
    </RecognitionProgress>}

 </>}{children}{(selected || withdrawing) && summary && <Modal title={withdrawing ? '撤回人员认可' : '认可此人'} busy={busy} onClose={() => {
      setSelected(null);
      setWithdrawing(false);
      setError('');
    }}>{withdrawing ? <p>撤回对 {archive.name} 的认可。本月额度不退回，本轮不能再次认可；已经发起的审核任务会保留并通知负责人。</p> : selected && <RecognitionConfirmation name={archive.name} version={selected.content_version} remaining={summary.quota.remaining} limit={summary.quota.limit} excerpt={selected.body.slice(0, 600)} />}<PageError error={error} retry={() => {
        setSelected(null);
        setWithdrawing(false);
        onChanged();
      }} retryLabel="重新读取后核对" /><ModalActions><button className="button primary" disabled={busy || !withdrawing && !summary.can_recognize} onClick={() => void submit()}>{busy ? '正在提交…' : withdrawing ? '确认撤回' : '确认认可'}</button></ModalActions></Modal>}</RecognitionContext.Provider>;
}
export function useRecognitionRound() {
  const summary = useContext(RecognitionContext)?.summary;
  return summary?.can_recognize ? summary.round_number : null;
}

export function ObservationRecognition({
  observation
}: {
  observation: Observation;
}) {
  const context = useContext(RecognitionContext);
  return context?.summary?.can_recognize && !observation.deleted ? <RecognitionButton onClick={() => context.select(observation)} /> : null;
}
