import { z } from 'zod';
import { PersonnelRecognition, recognitionInput, recognitionReadInput, recognitionWithdrawInput } from './personnel-recognition.ts';
import { registerJournalFields } from './mcp-journal.ts';
import type { McpReply } from './mcp-members.ts';
import type { Actor, Env } from './types.ts';
export const personnelToolNames = ['get_personnel_recognition', 'recognize_person', 'withdraw_personnel_recognition'];
registerJournalFields('get_personnel_recognition', ['archive_id']);
registerJournalFields('recognize_person', ['archive_id', 'round_number', 'observation_id', 'content_version', 'request_id']);
registerJournalFields('withdraw_personnel_recognition', ['id', 'request_id']);
export const personnelGuides = ['人员认可是依据具体观察版本，推荐启动对一个人物的人事审核，不表示审核通过或正式入社。先读取人物、相关观察及 get_personnel_recognition，再向用户呈现人物、依据、轮次和剩余额度。', '只有绑定正式社员档案的有效个人账号有认可权；每社员每北京时间自然月两份，同一人物同一轮次只计一次。管理员不能绕过；服务账号不能替人认可。三名不同社员认可后，原子创建一个待领取人事审核任务。', 'Agent 必须已有用户对这次认可或撤回的明确授权，才能调用 recognize_person / withdraw_personnel_recognition。不得从兴趣、表扬、知识库点赞或一般维护授权推断人员认可授权。认可消耗当前账号所绑定社员额度。', '跨月只刷新可新提交的额度，不使旧认可到期。撤回不返还额度，本轮不能再次认可。审核已经触发后撤回会通知负责人并保留任务；已完成或取消的旧任务与认可不自动计入下一轮。', '引用的是提交时阅读的 observation_id 和 content_version，修改观察不重写旧认可。已删除的依据不参与尚未触发的计数。提交失败或结果不明时，使用原 request_id 和原参数核对或重试；不能更换身份或反复换 ID 规避额度。', '审核任务的期限沿用既有默认七天；这不是认可有效期。通过审核和完成入社对接须由任务负责人分别交付 audit_passed / onboarding_completed，不能直接修改档案状态跳过。'];
export function registerPersonnelTools(server: any, env: Env, actor: Actor, reply: McpReply) {
  const service = new PersonnelRecognition(env, actor, 'mcp'),
    record = z.record(z.string(), z.unknown()),
    read = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    };
  server.registerTool('get_personnel_recognition', {
    description: '读取人物当前认可轮次、固定版本的依据、审核任务以及本人本月剩余额度；不消耗额度。',
    inputSchema: recognitionReadInput,
    outputSchema: record,
    annotations: read
  }, (a: any) => reply(() => service.summary(a)));
  server.registerTool('recognize_person', {
    description: '经用户明确授权，凭刚阅读的观察版本认可该人物。每社员每月两份、每人物每轮一次；第三份原子发起待领取审核，不等于入社。',
    inputSchema: recognitionInput,
    outputSchema: record,
    annotations: {
      ...read,
      readOnlyHint: false
    }
  }, (a: any) => reply(() => service.recognize(a)));
  server.registerTool('withdraw_personnel_recognition', {
    description: '经本人明确授权撤回认可；不退回月度额度、不取消已触发任务。',
    inputSchema: recognitionWithdrawInput,
    outputSchema: record,
    annotations: {
      ...read,
      readOnlyHint: false
    }
  }, (a: any) => reply(() => service.withdraw(a)));
}
