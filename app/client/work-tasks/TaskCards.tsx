import { type Member } from "../api";
import { Avatar } from "../Avatar";
import { avatarUrl } from "../AvatarEditor";
import { TaskRecommendationCard, TaskListRow } from "../../ui/TaskBook";
import { type Task } from '../../shared/work-tasks';
import { labels, displayDate, taskStage, remainingTime, taskActionTitle } from './presentation';
export function TaskIndexItem({
  task,
  actor,
  selected,
  onSelect,
  onDismiss,
  compact = false
}: {
  compact?: boolean;
  task: Task;
  actor: Member;
  selected: boolean;
  onSelect: () => void;
  onDismiss?: () => void;
}) {
  const stage = taskStage(task),
    closed = stage === 'failed' || stage === 'cancelled';
  return <TaskListRow compact={compact} stage={stage} title={taskActionTitle(task)} kind={task.labels?.[0] ?? labels[task.kind]} labels={task.labels} priority={task.priority ?? 'P2'} subject={task.archive_preview ? <><Avatar name={task.archive_preview.name} type={task.archive_preview.type} size="micro" src={avatarUrl('archive', task.archive_preview.id, task.archive_preview.version)} />{task.archive_preview.name}</> : '未关联档案'} owner={task.owner_id ? <><Avatar name={task.owner_name ?? '任务负责人'} size="micro" src={task.owner_version ? avatarUrl('member', task.owner_id, task.owner_version) : undefined} />{task.owner_id === actor.id ? '我' : task.owner_name ?? '已接取'}</> : undefined} deadline={displayDate(task.deadline_at)} remaining={remainingTime(task)} urgent={task.status === 'open' && Date.parse(task.deadline_at) - Date.now() < 86400000} selected={selected} onSelect={onSelect} onDismiss={closed ? onDismiss : undefined} />;
}
export function TaskRecommendation({
  task,
  onSelect,
  onRefresh
}: {
  task: Task | null;
  onSelect: (id: string) => void;
  onRefresh?: () => void;
}) {
  return <TaskRecommendationCard title={task ? taskActionTitle(task) : undefined} labels={task?.labels ?? (task ? [labels[task.kind]] : [])} subject={task?.archive_preview?.name ?? '未关联档案'} deadline={task ? remainingTime(task) : undefined} purpose={task?.purpose} portrait={task?.archive_preview ? <Avatar name={task.archive_preview.name} type={task.archive_preview.type} size="small" src={avatarUrl('archive', task.archive_preview.id, task.archive_preview.version)} /> : undefined} onSelect={() => task && onSelect(task.id)} onRefresh={onRefresh} />;
}
export function TaskInitiator({
  task
}: {
  task: Task;
}) {
  const name = task.initiator_name ?? '未知发起人';
  return <span className="task-owner-value">{task.initiator_id && <Avatar name={name} size="micro" src={avatarUrl('member', task.initiator_id, task.initiator_version ?? 0)} />} {name}</span>;
}
