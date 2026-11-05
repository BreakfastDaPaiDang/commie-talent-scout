import {archiveStateLabel} from './archive-states.ts';
import {archiveTransitionRules,preparePersonnelTask} from './archive-lifecycle.ts';
import {personnelDeliveryResults} from './task-delivery.ts';
import {reminderDays} from './archive-reminders.ts';
import {archiveFollowUpModule,archiveFollowUpRule} from './archive-follow-up.ts';
import {memberMonthlyModule,memberMonthlyRule} from './member-monthly-follow-up.ts';
import {taskNotificationsModule,TASK_REMINDER_WINDOW_MS} from './task-notifications.ts';
import type {InteractionGraph,InteractionRule} from '../shared/interaction-graph-types.ts';

// Business descriptions are tied to executed definitions; no code is evaluated in the browser.
// The generator ships the projection, and CI rejects stale output.
export async function buildInteractionGraph():Promise<InteractionGraph>{
 const nodes:InteractionGraph['nodes']=[
  {id:'accounts',title:'账号与权限',subtitle:'身份、本人绑定与访问边界',icon:'people',x:40,y:50,tone:'white'},
  {id:'agent',title:'Agent 接入',subtitle:'以成员身份使用共同业务能力',icon:'agent',x:40,y:390,tone:'white'},
  {id:'tags',title:'标签与词库',subtitle:'特征定义、绑定与依据',icon:'tag',x:400,y:50,tone:'white'},
  {id:'archives',title:'档案与资料',subtitle:'人物、社员、组织及观察材料',icon:'file',x:400,y:390,tone:'red'},
  {id:'tasks',title:'人事任务',subtitle:'领取、交付与人事推进',icon:'check',x:780,y:50,tone:'red'},
  {id:'automation',title:'早纪自动跟进',subtitle:'定时检查与去重补漏',icon:'history',x:780,y:390,tone:'yellow'},
  {id:'messages',title:'消息与阅读',subtitle:'任务提醒与档案未读',icon:'bell',x:1160,y:50,tone:'white'},
  {id:'statistics',title:'统计',subtitle:'按观察、标签与作者读取趋势',icon:'chart',x:1160,y:390,tone:'white'},
 ];
 const rules:InteractionRule[]=[];
 const add=(rule:InteractionRule)=>rules.push(rule);
 const life=archiveTransitionRules.map(r=>r.id);
 if(life.includes('personnel-task'))for(const status of ['人事审核','已加入待对接']){
  const planned=await preparePersonnelTask((()=>({first:async()=>null})) as unknown as Parameters<typeof preparePersonnelTask>[0],'projection',status,'2099-01-01T00:00:00Z');
  if(planned)add({id:'archive-'+planned.kind,from:'archives',to:'tasks',title:status==='人事审核'?'进入审核 → 创建审核任务':'审核通过 → 创建对接任务',kind:'action',trigger:`人物档案进入“${archiveStateLabel(status)}”`,conditions:['人物档案开启且未删除','没有同阶段的开启自动任务'],effects:[`创建待领取的${planned.kind==='audit'?'人事审核':'入社对接'}任务`,'任务和档案变化一起保存'],boundaries:['不沿用上一阶段负责人','更改档案状态本身不完成已有任务'],destination:'/tasks',source:'archive-lifecycle/personnel-task'});
 }
 for(const [id,rule] of Object.entries(personnelDeliveryResults))add({id,from:'tasks',to:'archives',title:rule.label+' → 推进档案',kind:'action',trigger:`负责人明确交付“${rule.label}”`,conditions:[`当前任务是自动${rule.kind==='audit'?'人事审核':'入社对接'}任务`,'引用至少一条关联档案观察','任务属于当前人事轮次，档案可维护'],effects:[`从“${archiveStateLabel(rule.from)}”推进至“${archiveStateLabel(rule.to)}”`,...(rule.kind==='audit'?['创建待领取的入社对接任务']:['同一档案进入社员范围并保持开启'])],boundaries:['无需第二个人审批','暂未联系到、建议继续和通用完成不推进','已经推进的不回退，重复提交不重复创建'],destination:'/tasks',source:'task-delivery/'+id});
 if(archiveFollowUpModule.rules.some(r=>r.id===archiveFollowUpRule))add({id:archiveFollowUpRule,from:'archives',to:'automation',title:'档案超期 → 接触跟进',kind:'scheduled',trigger:'每小时检查外部人物与组织的实际更新时间',conditions:[`普通外部档案超过 ${reminderDays('org','个人接触')} 天未更新`,`审核等人事阶段超过 ${reminderDays('person','人事审核')} 天未更新`,'排除社员、关闭和删除档案'],effects:['为本轮超期生成待领取的接触跟进任务'],boundaries:['同轮提醒或已有同类开启任务不叠加','不制造观察、不延后更新时间、不自动关闭档案'],destination:'/',source:archiveFollowUpModule.id});
 if(memberMonthlyModule.rules.some(r=>r.id===memberMonthlyRule))add({id:memberMonthlyRule,from:'archives',to:'automation',title:'正式社员 → 月度跟进',kind:'scheduled',trigger:'按北京时间每月生成，每小时补漏',conditions:['开启且未删除的正式社员','早纪服务账号可用'],effects:['每人每月一项 P2 待领取人事跟进任务','月底截止，不阻止下月生成'],boundaries:['请假、失联和暂不接工作仍持续跟进','同月已完成或取消不重建','写观察不自动完成月度任务'],destination:'/members',source:memberMonthlyModule.id});
 add({id:'automation-tasks',from:'automation',to:'tasks',title:'自动生成 → 进入待领取',kind:'scheduled',trigger:'符合超期或月度跟进规则',conditions:['提交时仍符合身份、版本和账号条件'],effects:['早纪发起任务并保留创建历史','等待成员主动领取'],boundaries:['不会自动指派给某个成员','重复调度不会重复创建同一义务'],destination:'/tasks',source:'archive-follow-up/member-monthly-follow-up'});
 if(taskNotificationsModule.rules.some(r=>r.id==='task.deadline'))add({id:'task.deadline',from:'tasks',to:'messages',title:'临期与逾期 → 提醒负责人',kind:'scheduled',trigger:`任务距截止时间不超过 ${TASK_REMINDER_WINDOW_MS/3600000} 小时，或已逾期`,conditions:['任务仍开启且已有负责人','负责人账号可用，期限与任务版本仍匹配'],effects:['生成本人的临期或逾期提醒'],boundaries:['延期、交还或关闭使旧提醒失效','逾期不会自动关闭或记作失败'],destination:'/messages',source:taskNotificationsModule.id});
 add({id:'archive-updates',from:'archives',to:'messages',title:'档案变化 → 个人未读',kind:'query',trigger:'查询当前成员可见的档案更新',conditions:['事件属于本人有权查看的内容','按个人阅读事实判断未读'],effects:['档案更新与任务提醒出现在同一消息中心'],boundaries:['摘要读取不代表读过正文','打开档案仅确认当时快照，不清除后来新增更新'],destination:'/messages',source:'notification-query/reading'});
 add({id:'observation-reference',from:'archives',to:'tasks',title:'档案观察 → 交付引用',kind:'action',trigger:'交付任务时选择已有观察，或直接留档后引用',conditions:['观察属于任务关联档案','内容版本存在且当前可见'],effects:['任务结果保留精确的观察版本引用'],boundaries:['保存观察不自动结束任务','评论不能替代所需档案观察'],destination:'/tasks',source:'task-delivery/taskRequiresObservation'});
 add({id:'tag-binding',from:'tags',to:'archives',title:'有据标签 → 描述档案',kind:'action',trigger:'成员明确选择标签并维护绑定依据',conditions:['词条可用于新绑定','依据与档案内容在权限内可见'],effects:['档案使用共同词库的特征与定义'],boundaries:['标签不决定人事阶段、任务类型或权限','停用、删除词条不会清除已有历史引用'],destination:'/tags',source:'tags/tag-state'});
 add({id:'statistics-archives',from:'archives',to:'statistics',title:'观察记录 → 统计趋势',kind:'query',trigger:'按日期、作者、档案类型或标签查询统计',conditions:['当前账号有权读取统计来源'],effects:['统计实际观察数量与趋势'],boundaries:['不是自动业务操作','查看统计不改变档案、任务或已读状态'],destination:'/statistics',source:'statistics'});
 add({id:'statistics-tags',from:'tags',to:'statistics',title:'标签绑定 → 分组查询',kind:'query',trigger:'统计选择按标签分组',conditions:['按当前可见依据计算，关闭档案使用冻结绑定'],effects:['按标签维度展示对应观察记录'],boundaries:['统计的是观察记录，不是给人物打分'],destination:'/statistics',source:'statistics/evidenceVisibilitySql'});
 add({id:'identity-link',from:'accounts',to:'archives',title:'本人账号绑定 → 昵称同步',kind:'action',trigger:'管理员确认本人账号绑定，或绑定账号修改昵称',conditions:['有明确身份依据','账号与人物唯一对应，不与维护者混用'],effects:['人物昵称跟随本人账号资料'],boundaries:['冻结不自动解绑','本人绑定不额外授予档案权限'],destination:'/account/profile',source:'person-account'});
 add({id:'agent-identity',from:'accounts',to:'agent',title:'专用凭据 → 成员身份',kind:'action',trigger:'成员复制专用接入信息并授权 Agent',conditions:['凭据有效，账号和授权仍可用'],effects:['Agent 在该成员身份下使用已开放能力'],boundaries:['不读取未提交的外部对话','撤销连接或冻结账号使旧凭据失效'],destination:'/agent',source:'credentials/auth'});
 for(const [to,title,destination] of [['archives','读写档案与观察','/agent'],['tasks','查询与交付任务','/tasks'],['tags','检索与整理标签','/tags']] as const)add({id:'agent-'+to,from:'agent',to,title:'Agent → '+title,kind:'action',trigger:'用户授权 Agent 执行对应操作',conditions:['使用当前成员权限与实际工具能力','业务写入仍需明确授权'],effects:['与网页执行相同业务规则'],boundaries:['不绕过权限、版本或观察引用要求','不会因接入而自动操作所有档案'],destination,source:'mcp/'+to});
 return {nodes,rules};
}
