import { TaskLabels } from "../TaskLabels";
import { taskMatchesLabels } from "../../rules/task-labels";
import { monthStartInBeijing } from "../../rules/task-book";
import { useState } from 'react';
import { type Member } from "../api";
import { Avatar } from "../Avatar";
import { avatarUrl } from "../AvatarEditor";
import { ScopeToolbar } from "../../ui/Workspace";
import { TaskBoardColumn, TaskBoardCard, type TaskStage } from "../../ui/TaskBook";
import { type ArchivePreview, type Task } from '../../shared/work-tasks';
import { labels, recentlyUpdated, priorityFirst, displayDate, taskActionTitle } from './presentation';
import { TaskInitiator } from './TaskCards';
import { TaskDetailModal } from './TaskDetail';
export function boardCardStage(task: Task): TaskStage {
  return task.status === 'cancelled' ? 'cancelled' : task.status === 'expired' ? 'failed' : task.status === 'completed' ? 'closed' : task.owner_id ? 'active' : 'waiting';
}
export function closedResult(task: Task) {
  if (task.status === 'completed') return '已完成';
  if (task.status === 'cancelled') return '已取消';
  if (task.status === 'expired') return '未完成关闭';
  return undefined;
}
export function BoardHall({
  tasks,
  searchTasks,
  actor,
  selectedTask,
  onSelect,
  onChanged,
  onOpenArchive
}: {
  tasks: Task[];
  searchTasks: Task[] | null;
  actor: Member;
  selectedTask: Task | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
  onOpenArchive: (archive: ArchivePreview, taskId?: string, observationId?: string, contentVersion?: number) => void;
}) {
  const [closedRange, setClosedRange] = useState<'30' | '90' | 'all'>('30');
  const [labelFilter, setLabelFilter] = useState<string[]>([]),
    [priorityFilter, setPriorityFilter] = useState('all'),
    [sort, setSort] = useState<'priority' | 'updated' | 'deadline'>('priority'),
    [filtersOpen, setFiltersOpen] = useState(false);
  const start = monthStartInBeijing(),
    closedCutoff = Date.now() - Number(closedRange) * 86400000,
    monthTasks = tasks.filter(task => Date.parse(task.updated_at ?? task.created_at) >= start);
  // The hall is an operational view: all open work remains visible, while
  // closed history is intentionally bounded to keep the default view useful.
  const source = (searchTasks ?? tasks).filter(task => task.status === 'open' || closedRange === 'all' || !!task.closed_at && Date.parse(task.closed_at) >= closedCutoff);
  const filtered = source.filter(task => taskMatchesLabels(task.label_keys ?? [task.kind], labelFilter) && (priorityFilter === 'all' || task.priority === priorityFilter)).sort((a, b) => sort === 'priority' ? priorityFirst(a, b) : sort === 'updated' ? recentlyUpdated(a, b) : Date.parse(a.deadline_at) - Date.parse(b.deadline_at) || recentlyUpdated(a, b));
  const waiting = filtered.filter(task => task.status === 'open' && !task.owner_id),
    active = filtered.filter(task => task.status === 'open' && !!task.owner_id),
    closed = filtered.filter(task => task.status !== 'open');
  const monthCompleted = monthTasks.filter(task => task.status === 'completed' && task.completed_at && Date.parse(task.completed_at) >= start).length;
  const overdue = tasks.filter(task => task.status === 'open' && Date.parse(task.deadline_at) <= Date.now()).length;
  const column = (stage: TaskStage, title: string, subtitle: string, rows: Task[]) => <TaskBoardColumn stage={stage} title={title} subtitle={subtitle} count={rows.length}>{rows.length ? rows.map(task => <TaskBoardCard key={task.id} stage={boardCardStage(task)} title={taskActionTitle(task)} subject={task.archive_preview ? <><Avatar name={task.archive_preview.name} type={task.archive_preview.type} size="micro" src={avatarUrl('archive', task.archive_preview.id, task.archive_preview.version)} />{task.archive_preview.name}</> : '未关联档案'} owner={task.owner_id ? <><Avatar name={task.owner_name ?? '任务负责人'} size="micro" src={task.owner_version ? avatarUrl('member', task.owner_id, task.owner_version) : undefined} />{task.owner_id === actor.id ? '我' : task.owner_name ?? '已接取'}</> : <span className="task-board-unassigned">尚未领取</span>} initiator={<TaskInitiator task={task} />} labels={task.labels ?? [labels[task.kind]]} priority={task.priority ?? 'P2'} deadline={displayDate(task.deadline_at)} overdue={task.overdue} result={closedResult(task)} selected={selectedTask?.id === task.id} onSelect={() => onSelect(task.id)} />) : <p className="task-board-empty">这一栏暂时没有任务。</p>}</TaskBoardColumn>;
  return <div className="task-hall">
  <section className="task-hall-board">
  <div className="task-hall-metrics"><div><strong>{monthTasks.length}</strong><span>本月更新</span></div><div><strong>{monthCompleted}</strong><span>本月完成</span></div><div><strong>{tasks.filter(task => task.status === 'open' && !task.owner_id).length}</strong><span>当前待领取</span></div><div className={overdue ? 'urgent' : ''}><strong>{overdue}</strong><span>当前逾期</span></div></div>
  <div className="task-board-toolbar"><ScopeToolbar heading={<strong>全组看板</strong>} scopeItems={[]} scope="all" onScope={() => {}} filtersOpen={filtersOpen} onFilters={() => setFiltersOpen(value => !value)} activeFilters={closedRange !== 'all' || labelFilter.length > 0 || priorityFilter !== 'all' || sort !== 'priority'} resetLabel="重置筛选" onReset={() => {
          setLabelFilter([]);
          setPriorityFilter('all');
          setSort('priority');
          setClosedRange('30');
        }} filters={<><label>已关闭任务<select aria-label="已关闭任务范围" value={closedRange} onChange={e => setClosedRange(e.target.value as typeof closedRange)}><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="all">全部</option></select></label><TaskLabels filter value={labelFilter} onChange={setLabelFilter} /><label>优先级<select aria-label="任务优先级" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}><option value="all">全部优先级</option><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option></select></label><label>排序<select aria-label="任务排序" value={sort} onChange={e => setSort(e.target.value as 'priority' | 'updated' | 'deadline')}><option value="priority">优先级从高到低</option><option value="updated">最近更新</option><option value="deadline">截止时间</option></select></label></>} /></div>
  <div className="task-board-columns">{column('waiting', '待领取', '还没有负责人，等待成员接取', waiting)}{column('active', '进行中', '已有负责人正在推进', active)}{column('closed', '已关闭', closedRange === 'all' ? '全部已关闭任务' : '最近 ' + closedRange + ' 天内关闭的任务', closed)}</div>
  <footer className="task-hall-footer"><span>点击任务卡查看目的、交付要求和评论历史。</span></footer>
  </section>
  {selectedTask && <TaskDetailModal task={selectedTask} actor={actor} onChanged={onChanged} onOpenArchive={onOpenArchive} onClose={() => onSelect(null)} />}
 </div>;
}
