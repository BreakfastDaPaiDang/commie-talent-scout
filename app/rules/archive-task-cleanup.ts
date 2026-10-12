import {planRules,type RuleModule} from './contract.ts';
type Context={archiveId:string;deleted:boolean;changed:boolean;actorId:string;source:string;at:string;stmt:(sql:string,...args:unknown[])=>D1PreparedStatement};
function archiveDeleted(c:Context){return c.changed&&c.deleted;}
function cancelAutomaticTasks(c:Context){
 const reason='档案已删除，关联自动任务不再适用';
 return [c.stmt(`INSERT INTO work_task_events(id,task_id,actor_id,source,kind,before_json,after_json,reason,created_at)
  SELECT lower(hex(randomblob(16))),id,?,?,'task.cancelled',json_object('status',status,'owner_id',owner_id,'version',version),json_object('status','cancelled','owner_id',owner_id,'version',version+1),?,?
  FROM work_tasks WHERE archive_id=? AND source='rule' AND status='open'`,c.actorId,c.source,reason,c.at,c.archiveId),
  c.stmt("UPDATE work_tasks SET status='cancelled',closed_reason=?,updated_at=?,version=version+1 WHERE archive_id=? AND source='rule' AND status='open'",reason,c.at,c.archiveId)];
}
export const archiveTaskCleanupModule:RuleModule<Context,D1PreparedStatement>={
 id:'archive-task-cleanup',source:'app/rules/archive-task-cleanup.ts',
 triggers:[{file:'app/server/archives.ts',entry:'setDeleted'}],
 rules:[{id:'archive.delete.cancel-automatic-tasks',when:archiveDeleted,apply:cancelAutomaticTasks}],
 verification:{transaction:{file:'app/server/commands.ts',entry:'command'},guard:{file:'app/server/archives.ts',entry:'setDeleted'},tests:['tests/monthly-work-tasks.test.mjs','tests/archive-follow-ups.test.mjs'],idempotency:'仅删除状态变化时处理开启自动任务；重复删除或恢复不改写任务历史。',failure:'与档案删除及版本保护一同提交，失败整体回滚。'},
};
export function planArchiveTaskCleanup(context:Context){return planRules(archiveTaskCleanupModule,context).statements;}
