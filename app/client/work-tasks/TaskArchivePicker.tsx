import { useEffect, useState } from 'react';
import { api } from '../api';

export type TaskArchive = { id: string; name: string; person_role?: string; status?: string };

export function TaskArchivePicker({ value, onChange }: {
  value: TaskArchive | null;
  onChange: (archive: TaskArchive | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<TaskArchive[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const term = query.trim();
    if (!term || value) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({type: 'person', person_scope: 'all', closed: 'open', query: term, limit: '30'});
        const {archives} = await api<{archives: TaskArchive[]}>('/archives?' + params);
        if (active) {
          setRows(archives);
          setMessage(archives.length ? '' : '没有找到匹配的人物');
        }
      } catch (error) {
        if (active) setMessage((error as Error).message);
      }
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [query, value]);
  function search(text: string) {
    setRows([]);
    setQuery(text);
    setMessage(text.trim() ? '正在查找…' : '');
  }
  return <div className="task-archive-picker">{value
    ? <div><span>相关对象：{value.name}</span> <button type="button" className="text-button" onClick={() => {search(''); onChange(null);}}>重新选择</button></div>
    : <><label>相关对象<input type="search" maxLength={200} value={query} placeholder="搜索外部人物或社员" onChange={e => search(e.target.value)} /></label>
      {message && <small role="status">{message}</small>}
      {!!rows.length && <div className="task-archive-options">{rows.map(row => <button type="button" className="button quiet" key={row.id} onClick={() => {search(''); onChange(row);}}>
        {row.name} · {row.person_role === 'member' || row.status === '已入伙' ? '社员' : '外部人物'}
      </button>)}</div>}</>}
  </div>;
}
