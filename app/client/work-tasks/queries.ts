import { api } from "../api";
import { type Task } from '../../shared/work-tasks';
export async function fetchTaskList(query = '') {
  const tasks: Task[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page: {
      tasks: Task[];
      next_offset?: number | null;
    } = await api('/work-tasks?' + new URLSearchParams({
      scope: 'all',
      state: 'all',
      limit: '100',
      offset: String(offset),
      ...(query ? {
        query
      } : {})
    }));
    tasks.push(...page.tasks);
    offset = page.next_offset ?? null;
  }
  return tasks;
}
