import { useState } from 'react';
import { api } from './api';
import { Modal } from './Modal';
import { PageError } from './ConnectionPages';
import type { Evidence } from '../shared/tags';
export const kindLabels = {
  observation: '观察材料',
  self_statement: '本人明确自述',
  member_instruction: '成员明确指令'
};
export function TagEvidence({
  items
}: {
  items: Evidence[];
}) {
  const [record, setRecord] = useState<{
      body: string;
      version: number;
      author_name: string;
    } | null>(null),
    [error, setError] = useState('');
  async function read(e: Evidence) {
    try {
      const r = await api<{
        versions: {
          version: number;
          body: string;
        }[];
        author_id: string;
      }>(`/observations/${e.observation_id}/versions?before=${e.content_version! + 1}&limit=1`);
      if (r.versions[0]?.version !== e.content_version) throw new Error('该来源版本当前不可读');
      setRecord({
        ...r.versions[0],
        author_name: '引用的观察版本'
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return <><PageError error={error} />{items.length ? <ul className="tag-evidence">{items.map((e, i) => <li key={i}><small>{kindLabels[e.kind]}</small><p>{e.note}</p>{e.observation_id && <button className="button quiet" onClick={() => void read(e)}>查看来源 · 版本 {e.content_version}</button>}</li>)}</ul> : <p className="secondary-copy">手工添加，未附依据</p>}{record && <Modal title={record.author_name} onClose={() => setRecord(null)} busy={false}><div className="observation-body">{record.body}</div></Modal>}</>;
}
