import { notifyMembershipJoined } from "../MembershipNotice";
import { MemberPicker } from "../ArchiveStateForm";
import type { BoundMember } from "../../shared/archives";
import { taskResultLabel } from "../../rules/task-delivery";
import { TaskLabels } from "../TaskLabels";
import { taskLabelKeys } from "../../rules/task-labels";
import { taskCanReopen } from "../../rules/task-policy.ts";
import React, { useState } from 'react';
import { api, type Member } from "../api";
import { PageError } from "../ConnectionPages";
import { Modal, ModalActions } from "../Modal";
import { Avatar } from "../Avatar";
import { avatarUrl } from "../AvatarEditor";
import { Icon } from "../../ui/icons";
import { TaskDetailCard } from "../../ui/TaskBook";
import { type ArchivePreview, type Task } from '../../shared/work-tasks';
import { labels, iso, localDateTime, displayDate, taskStage, remainingTime, taskActionTitle } from './presentation';
import { CompleteForm } from './TaskDelivery';
import { TaskHistory } from './TaskHistory';
import { TaskInitiator } from './TaskCards';
export function TaskAssignmentForm({
  busy,
  error,
  submit
}: {
  busy: boolean;
  error: string;
  submit: (member_id: string, reason: string) => Promise<void>;
}) {
  const [members, setMembers] = useState<BoundMember[]>([]),
    [reason, setReason] = useState('');
  return <form className="manage-form modal-form" onSubmit={e => {
    e.preventDefault();
    if (!busy && members.length === 1) void submit(members[0].id, reason);
  }}><MemberPicker label="负责人" multiple={false} value={members} onChange={setMembers} /><label>指派说明<textarea aria-label="指派说明" required maxLength={500} rows={3} value={reason} onChange={e => setReason(e.target.value)} /></label><PageError error={error} /><ModalActions><button className="button primary" disabled={busy || members.length !== 1 || !reason.trim()}>{busy ? '正在指派…' : '确认指派'}</button></ModalActions></form>;
}
export function TaskScene({
  task,
  actor,
  onChanged,
  onOpenArchive
}: {
  task: Task;
  actor: Member;
  onChanged: () => void;
  onOpenArchive: (archive: ArchivePreview, taskId: string, observationId?: string, contentVersion?: number) => void;
}) {
  const [dialog, setDialog] = useState<'edit' | 'extend' | 'reopen' | 'release' | 'complete' | 'assign' | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [days, setDays] = useState(3);
  const [title, setTitle] = useState(task.title),
    [purpose, setPurpose] = useState(task.purpose),
    [delivery, setDelivery] = useState(task.delivery),
    [selectedLabels, setSelectedLabels] = useState<string[]>(taskLabelKeys(task.label_keys ?? task.labels ?? [task.kind])),
    [priority, setPriority] = useState<'P0' | 'P1' | 'P2'>(task.priority ?? 'P2'),
    [deadline, setDeadline] = useState(localDateTime(task.deadline_at)),
    [cancelReason, setCancelReason] = useState('');
  const mine = task.owner_id === actor.id,
    canEdit = task.status === 'open' && (actor.role === 'admin' || task.created_by === actor.id || mine),
    canCancel = task.status === 'open' && (actor.role === 'admin' || task.created_by === actor.id && !task.owner_id || mine),
    canReopen = taskCanReopen(task, actor);
  const newDeadline = new Date((dialog === 'reopen' ? Date.now() : Date.parse(task.deadline_at)) + days * 86400000).toISOString();
  function openDialog(value: typeof dialog) {
    setError('');
    setTitle(task.title);
    setPurpose(task.purpose);
    setDelivery(task.delivery);
    setSelectedLabels(taskLabelKeys(task.label_keys ?? task.labels ?? [task.kind]));
    setPriority(task.priority ?? 'P2');
    setDeadline(localDateTime(task.deadline_at));
    setDays(3);
    setCancelReason('');
    setDialog(value);
  }
  async function command(action: string, data: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    try {
      await api('/work-tasks/' + action, {
        id: task.id,
        expected_version: task.version,
        request_id: crypto.randomUUID(),
        ...data
      });
      setDialog(null);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const archive = task.archive_preview;
  return <TaskDetailCard sharePath={'/tasks?task=' + encodeURIComponent(task.id)} stage={taskStage(task)} title={taskActionTitle(task)} kind={task.labels?.[0] ?? labels[task.kind]} code={task.id.slice(0, 8).toUpperCase()} assignment={actor.role === 'admin' && task.status === 'open' && <button className="button quiet" disabled={busy} onClick={() => openDialog('assign')}>指派负责人</button>} claim={task.status === 'open' && !task.owner_id && <button className="button primary" disabled={busy} onClick={() => void command('claim')}><Icon name="plus" />{busy ? '正在领取…' : '领取任务'}</button>} edit={canEdit && <button className="task-edit-button" onClick={() => openDialog('edit')} disabled={busy}><Icon name="edit" size={17} />编辑任务</button>} labels={task.labels?.length ? task.labels : [labels[task.kind]]} priority={task.priority ?? 'P2'} metadata={[{
    label: '相关对象',
    icon: 'people',
    value: archive ? <button className="task-object-link" onClick={() => onOpenArchive(archive, task.id)}><Avatar name={archive.name} type={archive.type} size="micro" src={avatarUrl('archive', archive.id, archive.version)} />{archive.name}</button> : '未关联档案'
  }, {
    label: '截止时间',
    icon: 'history',
    value: <><time>{displayDate(task.deadline_at)}</time><small>{remainingTime(task)}</small></>
  }, {
    label: '任务负责人',
    icon: 'people',
    value: task.owner_id ? <span className="task-owner-value"><Avatar name={task.owner_name ?? '任务负责人'} size="micro" src={task.owner_version ? avatarUrl('member', task.owner_id, task.owner_version) : undefined} />{task.owner_name ?? (task.owner_id === actor.id ? '我' : '已接取')}</span> : '—'
  }, {
    label: '发起人',
    icon: 'people',
    value: <TaskInitiator task={task} />
  }]} purpose={task.purpose} delivery={task.delivery} result={task.status !== 'open' && <section className="task-scene-section"><h3><Icon name="file" />任务结果</h3>{task.result_kind && <p>{taskResultLabel(task.result_kind)}</p>}<p>{task.result_text || task.closed_reason || '任务已关闭'}</p>{!!task.result_references?.length && archive && <div className="task-result-links">{task.result_references.map(reference => <button className="text-button" key={reference.observation_id} onClick={() => onOpenArchive(archive, task.id, reference.observation_id, reference.content_version)}>观察版本 {reference.content_version}</button>)}</div>}{task.result_references_restricted && <small className="comment-reference-hidden">部分观察引用当前不可见</small>}</section>} actions={<>
  {!dialog && <PageError error={error} />}
  {mine && task.status === 'open' && <><button className="button primary" disabled={busy} onClick={() => openDialog('complete')}><Icon name="check" />提交交付</button><button className="button quiet" disabled={busy} onClick={() => openDialog('extend')}><Icon name="history" />延期</button><button className="button quiet" disabled={busy} onClick={() => openDialog('release')}><Icon name="close" />放弃</button></>}
  {canReopen && <button className="button primary" disabled={busy} onClick={() => openDialog('reopen')}>重新开启</button>}
 </>}>
 <TaskHistory task={task} actor={actor} onOpenArchive={onOpenArchive} />
 {dialog === 'edit' && <Modal title="编辑任务" busy={busy} onClose={() => setDialog(null)}><form className="task-editor-form" onSubmit={e => {
        e.preventDefault();
        void command('edit', {
          title,
          purpose,
          delivery,
          labels: selectedLabels,
          priority,
          deadline_at: iso(deadline)
        });
      }}><label>任务标题<input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label><TaskLabels value={selectedLabels} onChange={setSelectedLabels} initialOptions={(task.label_keys ?? []).map((key, i) => ({
          key,
          name: task.labels?.[i] ?? key
        }))} /><label>优先级<select value={priority} onChange={e => setPriority(e.target.value as 'P0' | 'P1' | 'P2')}><option value="P0">P0 · 最高</option><option value="P1">P1 · 重要</option><option value="P2">P2 · 常规</option></select></label><label>任务目的<textarea rows={4} required maxLength={4000} value={purpose} onChange={e => setPurpose(e.target.value)} /></label><label>交付要求<textarea rows={4} required maxLength={4000} value={delivery} onChange={e => setDelivery(e.target.value)} /></label><label>截止时间<input required type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} /></label><section className="task-editor-actions" aria-label="任务操作"><h3>任务操作</h3><div className="task-editor-actions-row">{task.status === 'open' && !task.owner_id && <button type="button" className="button primary" disabled={busy} onClick={() => void command('claim')}><Icon name="plus" size={16} />领取任务</button>}{mine && task.status === 'open' && <><button type="button" className="button primary" disabled={busy} onClick={() => openDialog('complete')}><Icon name="check" size={16} />提交交付</button><button type="button" className="button quiet" disabled={busy} onClick={() => openDialog('extend')}><Icon name="history" size={16} />延期</button><button type="button" className="button quiet" disabled={busy} onClick={() => openDialog('release')}><Icon name="close" size={16} />放弃</button></>}{canReopen && <button type="button" className="button primary" disabled={busy} onClick={() => openDialog('reopen')}>重新开启</button>}</div></section><PageError error={error} /><ModalActions><button className="button primary" disabled={busy}>{busy ? '正在保存…' : '保存任务'}</button></ModalActions>{canCancel && <details className="task-editor-danger"><summary>取消这项任务</summary><label>取消原因<input value={cancelReason} onChange={e => setCancelReason(e.target.value)} maxLength={500} /></label><button type="button" className="text-button" disabled={busy || !cancelReason.trim()} onClick={() => void command('cancel', {
            reason: cancelReason.trim()
          })}>确认取消任务</button></details>}</form></Modal>}
 {(dialog === 'extend' || dialog === 'reopen') && <Modal title={dialog === 'extend' ? '延长任务期限' : '重新开启任务'} busy={busy} onClose={() => setDialog(null)}><form onSubmit={e => {
        e.preventDefault();
        void command(dialog === 'extend' ? 'extend' : 'reopen', {
          deadline_at: newDeadline,
          ...(dialog === 'reopen' ? {
            owner_mode: mine ? 'keep' : 'unassigned'
          } : {
            reason: `负责人延期 ${days} 天`
          })
        });
      }}>{dialog === 'reopen' && <p>{mine ? '由你继续负责。' : '任务将回到待接取。'}原交付结果和讨论保留在历史中。</p>}<fieldset className="task-delay-options"><legend>{dialog === 'extend' ? '在原截止时间上延长' : '新的任务期限'}</legend>{[1, 3, 7, 14].map(value => <label key={value}><input type="radio" name="delay" checked={days === value} onChange={() => setDays(value)} />{value} 天</label>)}</fieldset><p className="task-delay-preview">{dialog === 'extend' && <>原截止：{displayDate(task.deadline_at)}<br /></>}新截止：<strong>{displayDate(newDeadline)}</strong></p><PageError error={error} /><ModalActions><button className="button primary" disabled={busy}>{busy ? '正在保存…' : dialog === 'extend' ? '确认延期' : '重新开启'}</button></ModalActions></form></Modal>}
 {dialog === 'assign' && <Modal title="指派负责人" busy={busy} onClose={() => setDialog(null)}><TaskAssignmentForm busy={busy} error={error} submit={(member_id, reason) => command('assign', {
        member_id,
        reason
      })} /></Modal>}
 {dialog === 'release' && <Modal title="放弃任务" busy={busy} onClose={() => setDialog(null)}><p>任务将回到待接取，交给其他成员继续。已经留下的评论和历史都会保留。</p><PageError error={error} /><ModalActions><button className="button primary" disabled={busy} onClick={() => void command('release', {
          deadline_at: task.deadline_at
        })}>交还任务</button></ModalActions></Modal>}
 {dialog === 'complete' && <Modal title="提交交付" busy={busy} onClose={() => setDialog(null)}><CompleteForm task={task} onBusyChange={setBusy} onSaved={(result, requestId) => {
        setDialog(null);
        onChanged();
        notifyMembershipJoined(result, requestId);
      }} /></Modal>}
 </TaskDetailCard>;
}
export function TaskDetailModal({
  onClose,
  ...props
}: React.ComponentProps<typeof TaskScene> & {
  onClose: () => void;
}) {
  return <Modal title="任务详情" wide onClose={onClose}><TaskScene key={props.task.id} {...props} /></Modal>;
}
