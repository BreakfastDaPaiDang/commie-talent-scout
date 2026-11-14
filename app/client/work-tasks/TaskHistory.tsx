import { taskResultLabel } from "../../rules/task-delivery";
import { archiveStateLabel } from "../../rules/archive-states";
import React, { useEffect, useState, type FormEvent } from 'react';
import { api, type Member } from "../api";
import { PageError } from "../ConnectionPages";
import { Avatar } from "../Avatar";
import { Icon } from "../../ui/icons";
import { RecordBody } from "../../ui/Workspace";
import { type ArchivePreview, type Task } from '../../shared/work-tasks';
import { displayDate } from './presentation';
export const taskUi = {
  member: '\u6210\u5458',
  system: '\u7cfb\u7edf',
  edit: '\u7f16\u8f91',
  remove: '\u5220\u9664',
  restore: '\u6062\u590d',
  deleted: '\u8bc4\u8bba\u5df2\u5220\u9664',
  hidden: '\u90e8\u5206\u89c2\u5bdf\u5f15\u7528\u5f53\u524d\u4e0d\u53ef\u89c1',
  editPrompt: '\u4fee\u6539\u8bc4\u8bba',
  confirmDelete: '\u5220\u9664\u540e\u4ecd\u53ef\u6062\u590d\uff0c\u7ee7\u7eed\u5417\uff1f',
  hideHistory: '\u6536\u8d77\u5386\u53f2',
  showHistory: '\u67e5\u770b\u64cd\u4f5c\u5386\u53f2\u4e0e\u8bc4\u8bba',
  loading: '\u6b63\u5728\u8bfb\u53d6\u2026',
  comments: '\u5de5\u4f5c\u8bc4\u8bba',
  placeholder: '\u8bb0\u5f55\u8fdb\u5c55\u3001\u56f0\u96be\u6216\u4e0b\u4e00\u6b65',
  saving: '\u6b63\u5728\u4fdd\u5b58\u2026',
  add: '\u53d1\u8868\u8bc4\u8bba',
  readonly: '\u4efb\u52a1\u5df2\u5173\u95ed\uff0c\u5386\u53f2\u53ea\u8bfb\uff1b\u91cd\u65b0\u5f00\u542f\u540e\u53ef\u7ee7\u7eed\u8ba8\u8bba'
};
export const taskUiExtended = {
  versionHistory: '编辑历史',
  references: '引用观察',
  change: '变更'
};
export type TaskEvent = {
  references?: {
    observation_id: string;
    archive_id: string;
    content_version: number;
  }[];
  references_restricted?: boolean;
  kind: string;
  actor_name?: string | null;
  reason?: string | null;
  created_at: string;
  before_json?: string | null;
  after_json?: string | null;
};
export type CommentVersion = {
  version: number;
  body: string | null;
  deleted: boolean;
  deleted_at?: string | null;
  references: {
    observation_id: string;
    archive_id: string;
    content_version: number;
  }[];
  references_restricted?: boolean;
  actor_id?: string | null;
  source?: string;
  created_at: string;
};
export type TaskComment = {
  id: string;
  task_id: string;
  author_id: string;
  author_name?: string | null;
  body: string | null;
  references: {
    observation_id: string;
    archive_id: string;
    content_version: number;
  }[];
  history: CommentVersion[];
  created_at: string;
  updated_at: string;
  deleted: boolean;
  version: number;
  references_restricted?: boolean;
};
export const eventLabels: Record<string, string> = {
  contact_attempted: '记录联系尝试',
  created: '创建任务',
  claimed: '领取任务',
  assigned: '指派任务',
  released: '交还任务',
  cancelled: '取消任务',
  edited: '修改任务',
  deadline_changed: '延长截止时间',
  reopened: '重新开启任务',
  expired: '任务到期',
  completed: '提交结果并完成',
  archive_status_changed: '档案状态变化',
  comment_created: '发表评论',
  comment_updated: '编辑评论',
  comment_deleted: '删除评论',
  comment_restored: '恢复评论'
};
export const fieldLabels: Record<string, string> = {
  title: '标题',
  purpose: '目的',
  delivery: '交付要求',
  deadline_at: '截止时间',
  owner_id: '负责人',
  status: '状态',
  result_kind: '结果类型',
  result_text: '结果说明',
  completed_at: '完成时间',
  closed_reason: '关闭原因',
  result_reference_count: '引用数量',
  version: '版本',
  reference_count: '引用数量',
  comment_id: '评论'
};
export function parseEvent(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
export function eventValue(key: string, value: unknown) {
  if (key === 'result_kind' && typeof value === 'string') return taskResultLabel(value);
  if (key === 'archive_status' && typeof value === 'string') return archiveStateLabel(value);
  if (value === null || value === undefined || value === '') return '无';
  if (['deadline_at', 'completed_at'].includes(key) && typeof value === 'string') return displayDate(value);
  if (key === 'owner_id') return typeof value === 'string' ? value.slice(0, 8) : '无人负责';
  if (key === 'status') {
    const labels: Record<string, string> = {
      open: '进行中',
      completed: '已完成',
      expired: '已过期',
      cancelled: '已取消'
    };
    return labels[String(value)] ?? String(value);
  }
  return String(value);
}
export function eventChanges(event: TaskEvent) {
  const before = parseEvent(event.before_json),
    after = parseEvent(event.after_json);
  if (!before && !after) return [];
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(key => !['version', 'comment_id', 'reference_count'].includes(key));
  return keys.filter(key => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])).map(key => ({
    key,
    before: eventValue(key, before?.[key]),
    after: eventValue(key, after?.[key])
  }));
}
export function TaskCommentItem({
  item,
  task,
  actor,
  busy,
  onEdit,
  onDelete,
  onRestore,
  onReference
}: {
  item: TaskComment;
  task: Task;
  actor: Member;
  busy: boolean;
  onEdit: (item: TaskComment) => void;
  onDelete: (item: TaskComment) => void;
  onRestore: (item: TaskComment) => void;
  onReference: (reference: {
    observation_id: string;
    archive_id: string;
    content_version: number;
  }) => void;
}) {
  const canChange = item.author_id === actor.id || actor.role === 'admin';
  return <article className="work-task-comment"><header><Avatar name={item.author_name ?? taskUi.member} size="micro" /><strong>{item.author_name ?? taskUi.member}</strong><time>{displayDate(item.created_at)}</time></header>{item.deleted && item.body === null ? <p className="comment-deleted">{taskUi.deleted}</p> : <><RecordBody body={item.body ?? ''} />{item.references.length > 0 && <div className="task-comment-references"><small>{taskUiExtended.references}</small>{item.references.map(reference => <button type="button" className="text-button" key={reference.observation_id + '-' + reference.content_version} onClick={() => onReference(reference)}>观察版本 {reference.content_version}</button>)}</div>}{item.references_restricted && <small className="comment-reference-hidden">{taskUi.hidden}</small>}</>} {item.history.length > 1 && <details className="task-comment-history"><summary>{taskUiExtended.versionHistory}（{item.history.length}）</summary><ol>{item.history.map(version => <li key={version.version}><header><strong>版本 {version.version}</strong><time>{displayDate(version.created_at)}</time></header>{version.body === null ? <p className="comment-deleted">{taskUi.deleted}</p> : <p>{version.body}</p>}{version.references.length > 0 && <small>{taskUiExtended.references} {version.references.map(reference => `观察版本 ${reference.content_version}`).join('、')}</small>}{version.references_restricted && <small className="comment-reference-hidden">{taskUi.hidden}</small>}</li>)}</ol></details>}<footer>{!item.deleted && canChange && <button type="button" className="text-button" disabled={busy || task.status !== 'open'} onClick={() => onEdit(item)}>{taskUi.edit}</button>}{!item.deleted && canChange && <button type="button" className="text-button" disabled={busy || task.status !== 'open'} onClick={() => onDelete(item)}>{taskUi.remove}</button>}{item.deleted && canChange && <button type="button" className="text-button" disabled={busy || task.status !== 'open'} onClick={() => onRestore(item)}>{taskUi.restore}</button>}</footer></article>;
}
export function TaskHistory({
  task,
  actor,
  onOpenArchive
}: {
  task: Task;
  actor: Member;
  onOpenArchive: (archive: ArchivePreview, taskId: string, observationId?: string, contentVersion?: number) => void;
}) {
  const [events, setEvents] = useState<TaskEvent[]>([]),
    [comments, setComments] = useState<TaskComment[]>([]),
    [comment, setComment] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const loadSequence = React.useRef(0);
  const [cursors, setCursors] = useState<{
    comments: string | null;
    events: string | null;
  }>({
    comments: null,
    events: null
  });
  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError('');
    try {
      const r = await api<{
        events: TaskEvent[];
        comments: TaskComment[];
        events_next_cursor?: string | null;
        comments_next_cursor?: string | null;
      }>('/work-tasks/' + task.id);
      if (sequence !== loadSequence.current) return;
      setEvents(r.events ?? []);
      setComments(r.comments ?? []);
      setCursors({
        comments: r.comments_next_cursor ?? null,
        events: r.events_next_cursor ?? null
      });
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    setEvents([]);
    setComments([]);
    setCursors({
      comments: null,
      events: null
    });
    void load();
    return () => {
      loadSequence.current++;
    };
  }, [task.id, task.version]);
  async function loadMore() {
    const sequence = loadSequence.current;
    setBusy(true);
    setError('');
    try {
      for (const section of ['comments', 'events'] as const) {
        const cursor = cursors[section];
        if (!cursor) continue;
        const r = await api<{
          items: TaskComment[] | TaskEvent[];
          next_cursor: string | null;
        }>('/work-tasks/' + task.id + '/history?' + new URLSearchParams({
          section,
          cursor
        }));
        if (sequence !== loadSequence.current) return;
        if (section === 'comments') setComments(old => [...old, ...(r.items as TaskComment[])]);else setEvents(old => [...old, ...(r.items as TaskEvent[])]);
        setCursors(old => ({
          ...old,
          [section]: r.next_cursor
        }));
      }
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api('/work-tasks/comments/create', {
        task_id: task.id,
        body: comment.trim(),
        request_id: crypto.randomUUID()
      });
      setComment('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function edit(item: TaskComment) {
    const body = window.prompt(taskUi.editPrompt, item.body ?? '');
    if (body === null || !body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api('/work-tasks/comments/edit', {
        id: item.id,
        expected_version: item.version,
        body: body.trim(),
        request_id: crypto.randomUUID()
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: TaskComment) {
    if (!window.confirm(taskUi.confirmDelete)) return;
    setBusy(true);
    setError('');
    try {
      await api('/work-tasks/comments/delete', {
        id: item.id,
        expected_version: item.version,
        request_id: crypto.randomUUID()
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore(item: TaskComment) {
    setBusy(true);
    setError('');
    try {
      await api('/work-tasks/comments/restore', {
        id: item.id,
        expected_version: item.version,
        request_id: crypto.randomUUID()
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const entries = [...events.map((event, index) => ({
    kind: 'event' as const,
    at: event.created_at,
    event,
    index
  })), ...comments.map(item => ({
    kind: 'comment' as const,
    at: item.created_at,
    item
  }))].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return <section className="work-task-history" aria-label="评论与历史">
  <h3 className="task-history-title"><Icon name="file" />评论与历史 <span>{cursors.comments ? '已加载 ' : ''}{comments.length} 条评论</span></h3>
  {task.status === 'open' ? <form className="task-comment-compose" onSubmit={e => void add(e)}><Icon name="plus" /><textarea aria-label="任务评论" rows={2} maxLength={5000} value={comment} onChange={e => setComment(e.target.value)} placeholder="写下新的进展、困难或下一步…" required /><button className="button primary" disabled={busy || !comment.trim()}>{busy ? taskUi.saving : taskUi.add}</button></form> : <p className="task-scene-readonly">{taskUi.readonly}</p>}
  <PageError error={error} retry={() => void load()} />{loading && <p className="task-history-loading">正在读取评论与历史…</p>}
  <div className="task-activity">{entries.map(entry => {
        if (entry.kind === 'comment') return <div className="task-activity-entry" key={entry.item.id}><TaskCommentItem item={entry.item} task={task} actor={actor} busy={busy} onEdit={item => void edit(item)} onDelete={item => void remove(item)} onRestore={item => void restore(item)} onReference={reference => task.archive_preview && onOpenArchive(task.archive_preview, task.id, reference.observation_id, reference.content_version)} /></div>;
        const event = entry.event,
          changes = eventChanges(event);
        return <article className="task-activity-entry task-event-entry" key={'event-' + entry.index}><header><strong>{eventLabels[event.kind.replace('task.', '')] ?? event.kind.replace('task.', '')}</strong><span>{event.actor_name ?? taskUi.system} · {displayDate(event.created_at)}</span></header>{event.reason && <small>{event.reason}</small>}{changes.length > 0 && <details><summary>查看变化</summary><ul>{changes.map(change => <li key={change.key}>{fieldLabels[change.key] ?? change.key}：{change.before} → {change.after}</li>)}</ul></details>}{event.references?.map(reference => <button type="button" className="text-button" key={reference.observation_id + '-' + reference.content_version} onClick={() => task.archive_preview && onOpenArchive(task.archive_preview, task.id, reference.observation_id, reference.content_version)}>观察版本 {reference.content_version}</button>)}{event.references_restricted && <small className="comment-reference-hidden">部分观察引用当前不可见</small>}</article>;
      })}</div>
  {(cursors.comments || cursors.events) && <button type="button" className="button outline" disabled={busy || loading} onClick={() => void loadMore()}>{busy ? '正在加载…' : '加载更早记录'}</button>}
 </section>;
}
