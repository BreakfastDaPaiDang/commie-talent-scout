import { taskProcessingState } from "../../rules/task-book";
import { taskLabelNames } from "../../rules/task-policy.ts";
import { type Task } from '../../shared/work-tasks';
export const labels = taskLabelNames;
export const recentlyUpdated = (a: Task, b: Task) => Date.parse(b.updated_at ?? b.created_at) - Date.parse(a.updated_at ?? a.created_at) || a.id.localeCompare(b.id);
export const priorityFirst = (a: Task, b: Task) => (a.priority ?? 'P2').localeCompare(b.priority ?? 'P2') || recentlyUpdated(a, b);
export const deadlineDefault = () => {
  const d = new Date(Date.now() + 7 * 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const iso = (value: string) => new Date(value).toISOString();
export const localDateTime = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export const displayDate = (value: string) => new Date(value).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour12: false,
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});
export const purposeDefault = '说明本次要处理的对象、判断或行动。';
export const deliveryDefault = '结果写回关联档案；没有关联档案时，在任务结果中交代。';
export const taskStage = taskProcessingState;
export function remainingTime(task: Task, at = Date.now()) {
  if (task.status !== 'open') return undefined;
  const ms = Date.parse(task.deadline_at) - at;
  if (ms <= 0) return '已逾期';
  if (ms < 3600000) return `剩余 ${Math.ceil(ms / 60000)} 分钟`;
  if (ms < 86400000) return `剩余 ${Math.ceil(ms / 3600000)} 小时`;
  return `剩余 ${Math.ceil(ms / 86400000)} 天`;
}
export function taskActionTitle(task: Task) {
  const name = task.archive_preview?.name;
  return name && task.title.startsWith(`${name} ${'\u00b7'} `) ? task.title.slice(name.length + 3) : task.title;
}
export function taskLabelName(key: string) {
  return labels[key as Task['kind']] ?? key;
}
