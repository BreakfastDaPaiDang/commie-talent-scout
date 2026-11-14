import { type Source } from './commands.ts';
import { now, type Actor, type Env } from './types.ts';
import * as history from './work-tasks/history.ts';
import * as queries from './work-tasks/queries.ts';
import * as delivery from './work-tasks/delivery.ts';
import * as operations from './work-tasks/operations.ts';
import * as comments from './work-tasks/comments.ts';
import { createTaskContext, type ServiceContext } from './work-tasks/context.ts';
// Stable HTTP/MCP entry point. Each operation owns its business transaction.
export * from './work-tasks/inputs.ts';
export class WorkTasks {
  private readonly context: ServiceContext;
  constructor(env: Env, actor: Actor, source: Source) {
    this.context = createTaskContext(env, actor, source);
  }
  history(input: unknown) {
    return history.readTaskHistory(this.context, input);
  }
  create(input: unknown) {
    return operations.createTask(this.context, input);
  }
  list(input: unknown = {}) {
    return queries.listTasks(this.context, input);
  }
  claim(input: unknown) {
    return operations.claimTask(this.context, input);
  }
  complete(input: unknown) {
    return delivery.completeTask(this.context, input);
  }
  release(input: unknown) {
    return operations.releaseTask(this.context, input);
  }
  cancel(input: unknown) {
    return operations.cancelTask(this.context, input);
  }
  edit(input: unknown) {
    return operations.editTask(this.context, input);
  }
  extend(input: unknown) {
    return operations.extendTask(this.context, input);
  }
  reopen(input: unknown) {
    return operations.reopenTask(this.context, input);
  }
  addComment(input: unknown) {
    return comments.addTaskComment(this.context, input);
  }
  editComment(input: unknown) {
    return comments.editTaskComment(this.context, input);
  }
  deleteComment(input: unknown) {
    return comments.deleteTaskComment(this.context, input);
  }
  restoreComment(input: unknown) {
    return comments.restoreTaskComment(this.context, input);
  }
  detail(id: string) {
    return queries.getTaskDetail(this.context, id);
  }
  expire(at = now()) {
    return operations.expireTasks(this.context, at);
  }
  refer(input: unknown) {
    return delivery.referArchive(this.context, input);
  }
  confirmMembership(input: unknown) {
    return delivery.confirmMembership(this.context, input);
  }
  assign(input: unknown) {
    return operations.assignTask(this.context, input);
  }
  duePushes(at = now()) {
    return operations.pushDueTasks(this.context, at);
  }
}
