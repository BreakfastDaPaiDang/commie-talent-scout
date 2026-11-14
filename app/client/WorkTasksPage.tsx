import { useTaskList } from './work-tasks/useTaskList';
import { TaskLabels } from "./TaskLabels";
import { taskMatchesLabels } from "../rules/task-labels";
import { compareTaskBook, personalTaskCompletions } from "../rules/task-book";
import { useEffect, useState } from 'react';
import { type Member } from "./api";
import { PageError } from "./ConnectionPages";
import { Icon } from "../ui/icons";
import { ArchiveHead } from "../ui/Workspace";
import { TaskCompletionRecord, TaskBookLayout } from "../ui/TaskBook";
import { type ArchivePreview } from '../shared/work-tasks';
import { priorityFirst, taskStage } from './work-tasks/presentation';
import { CreateTask } from './work-tasks/TaskCreation';
import { TaskIndexItem, TaskRecommendation } from './work-tasks/TaskCards';
import { TaskScene } from './work-tasks/TaskDetail';
import { BoardHall } from './work-tasks/TaskBoard';
export function WorkTasksPage({
  actor,
  onOpenArchive
}: {
  actor: Member;
  onOpenArchive: (archive: ArchivePreview, taskId?: string, observationId?: string, contentVersion?: number) => void;
}) {
  const {
    tasks,
    loading,
    error,
    query,
    setQuery,
    searchTasks,
    searching,
    searchError,
    load,
    refresh
  } = useTaskList();
  const [view, setView] = useState<'book' | 'hall'>('book'),
    [listStatus, setListStatus] = useState('all'),
    [listLabel, setListLabel] = useState<string[]>([]),
    [filtersOpen, setFiltersOpen] = useState(false),
    [dismissed, setDismissed] = useState<string[]>(() => {
      try {
        return JSON.parse(localStorage.getItem(`task-book-dismissed:${actor.id}`) ?? '[]') as string[];
      } catch {
        return [];
      }
    });
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(location.search).get('task'));
  useEffect(() => {
    const sync = () => setSelectedId(new URLSearchParams(location.search).get('task'));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const [, setClock] = useState(Date.now());
  const selectedTask = tasks.find(task => task.id === selectedId) ?? searchTasks?.find(task => task.id === selectedId) ?? null;
  const updateSelection = (id: string | null) => {
    setSelectedId(id);
    const params = new URLSearchParams(location.search);
    if (id) params.set('task', id);else params.delete('task');
    history.pushState(null, '', location.pathname + (params.size ? '?' + params.toString() : ''));
  };
  const personal = (searchTasks ?? tasks).filter(task => {
    if (task.status === 'completed' || (task.status === 'expired' || task.status === 'cancelled') && dismissed.includes(task.id + ':' + task.version)) return false;
    return task.status === 'open' ? task.owner_id === actor.id || task.owner_id === null : task.owner_id === actor.id || task.created_by === actor.id;
  });
  const completions = personalTaskCompletions(tasks, actor.id);
  const visiblePersonal = personal.filter(task => listStatus === 'all' || taskStage(task) === listStatus).filter(task => taskMatchesLabels(task.label_keys ?? [task.kind], listLabel)).sort(compareTaskBook);
  const dismiss = (id: string) => setDismissed(current => {
    const next = [...new Set([...current, id])];
    try {
      localStorage.setItem(`task-book-dismissed:${actor.id}`, JSON.stringify(next));
    } catch {}
    return next;
  });
  const recommendationPool = personal.filter(task => task.status === 'open' && !task.owner_id).sort(priorityFirst);
  const [recommendationIndex, setRecommendationIndex] = useState(0);
  const recommendation = recommendationPool.length ? recommendationPool[recommendationIndex % recommendationPool.length] ?? null : null;
  return <main className="account-content work-tasks-page task-workspace"><div className="task-workspace-head"><ArchiveHead label="任务" count="" query={query} onQuery={value => {
        setQuery(value);
        updateSelection(null);
      }} searchLabel="搜索任务" searchPlaceholder="搜索任务、相关对象" createControl={<CreateTask onSaved={refresh} />} /></div><nav className="task-page-tabs" aria-label="任务页面"><button className={view === 'book' ? 'active' : ''} onClick={() => {
        setView('book');
        updateSelection(null);
      }}>任务簿</button><button className={view === 'hall' ? 'active' : ''} onClick={() => {
        setView('hall');
        updateSelection(null);
      }}>看板大厅</button></nav>
 <PageError error={searchError} />{searching && <p role="status">正在搜索任务…</p>}
 {selectedId && !loading && !error && !selectedTask && <p className="form-error" role="alert">该任务不存在或当前不可见。<button className="text-button" onClick={() => updateSelection(null)}>返回任务簿</button></p>}
 {view === 'hall' ? <><PageError error={error} retry={() => void load()} />{loading && !tasks.length ? <p role="status">正在读取任务…</p> : <BoardHall tasks={tasks} searchTasks={searchTasks} actor={actor} selectedTask={selectedTask} onSelect={updateSelection} onChanged={refresh} onOpenArchive={onOpenArchive} />}</> : <><PageError error={error} retry={() => void load()} />{loading && !tasks.length ? <p role="status">正在读取任务…</p> : <TaskBookLayout selected={!!selectedTask} left={<>
 <TaskCompletionRecord {...completions} />
 <TaskRecommendation task={recommendation} onSelect={updateSelection} onRefresh={recommendationPool.length > 1 ? () => setRecommendationIndex(index => index + 1) : undefined} />
 <section className="task-index-panel" aria-label="任务簿"><div className="task-book-toolbar"><strong>我的任务</strong><small>（{personal.length}）</small><div className="task-book-controls"><button aria-expanded={filtersOpen} onClick={() => setFiltersOpen(v => !v)}><Icon name="filter" size={16} />{listStatus !== 'all' || listLabel.length > 0 ? '已筛选' : '筛选'}</button><button aria-label="刷新任务" title="刷新任务" disabled={loading} onClick={refresh}><Icon name="history" size={17} /></button></div></div>
 {filtersOpen && <div className="task-book-filters"><label>状态<select aria-label="任务状态" value={listStatus} onChange={e => setListStatus(e.target.value)}><option value="all">全部状态</option><option value="failed">未完成关闭</option><option value="ready">待提交</option><option value="active">进行中</option><option value="waiting">待接取</option><option value="cancelled">已取消</option></select></label><TaskLabels filter value={listLabel} onChange={setListLabel} /><button className="text-button" onClick={() => {
              setListStatus('all');
              setListLabel([]);
            }}>清除</button></div>}
 <div className="task-index">{visiblePersonal.length ? visiblePersonal.map(task => <TaskIndexItem key={task.id} task={task} actor={actor} selected={selectedId === task.id} onSelect={() => updateSelection(task.id)} onDismiss={() => dismiss(task.id + ':' + task.version)} />) : <p className="task-index-empty">{query.trim() ? '没有匹配的任务' : '暂时没有需要处理的任务'}</p>}</div></section>
 </>} detail={selectedTask ? <div className="task-detail-column"><button className="text-button task-detail-back" onClick={() => updateSelection(null)}><Icon name="back" size={16} />返回任务簿</button><TaskScene key={selectedTask.id} task={selectedTask} actor={actor} onChanged={refresh} onOpenArchive={onOpenArchive} /></div> : <aside className="task-scene-empty"><h2>选择一项任务</h2><p>查看任务目的、交付要求与工作进展。</p></aside>} />}</>}
 </main>;
}
export type { Task } from '../shared/work-tasks';
export type { ArchivePreview } from '../shared/work-tasks';
export { TaskDetailModal } from './work-tasks/TaskDetail';
export { TaskIndexItem } from './work-tasks/TaskCards';
