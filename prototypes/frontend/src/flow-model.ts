import type {FlowAction,FlowActor,FlowData,FlowEvent,FlowTask} from '../../../app/ui/flow-types.ts';

// In-memory interaction model only. No production business operations or migration.
export const flowActors:FlowActor[]=[{id:'zhou',name:'周宁',role:'member'},{id:'shen',name:'沈舟',role:'member'},{id:'he',name:'许禾',role:'admin'}];
const stamp=(text:string,actor='系统',at='2026-09-29T09:00:00+08:00'):FlowEvent=>({id:crypto.randomUUID(),text,actor,at});
const task=(id:string,personId:string,type:FlowTask['type'],title:string,ownerId:string|null=null):FlowTask=>({id,personId,type,title,purpose:type==='audit'?'了解对方的情况与参与意愿，留下可以继续处理的审核结论。':type==='onboarding'?'帮助新社员了解组织、工作组与后续联系安排，接住加入后的第一步。':type==='monthly'?'了解近期生活与参与情况、困难和需要支持的事情。联系不到时也可以如实交代。':'围绕这次合作确认安排，记录双方行动和后续约定。',delivery:'将结果与待关注事项写入关联档案；任务引用原记录，无需在评论重复提交。',open:true,ownerId,deadline:'2026-10-06T18:00:00+08:00',history:[stamp(ownerId?'任务已领取':'任务已创建 · 等待领取')],comments:[],noteIds:[]});
export function initialFlow():FlowData{
 const failed={...task('monthly-old','p3','monthly','九月近况沟通','zhou'),open:false,result:'failed' as const,month:'2026-09',deadline:'2026-09-27T18:00:00+08:00'};
 failed.history.push({...stamp('到期未完成 · 原结果保留'),result:'failed'});
 return {now:'2026-09-29T10:00:00+08:00',people:[
  {id:'p1',name:'林澈',kind:'person',member:false,relation:'个人接触',subtitle:'关注影像与社区记录，最近表达了进一步参与的意愿。',tags:['技能：影像剪辑','参与意向：社区记录'],contact:'linche@example.invalid'},
  {id:'p2',name:'岑夏',kind:'person',member:true,relation:'社员',subtitle:'刚加入内容小组，正在了解协作方式。',tags:['发展方向：内容编辑'],contact:'cenxia@example.invalid'},
  {id:'p3',name:'陆遥',kind:'person',member:true,relation:'社员',subtitle:'持续参与资料整理，本月需要了解近况。',tags:['技能：资料整理'],contact:'luyao@example.invalid'},
  {id:'p4',name:'江禾',kind:'person',member:false,relation:'外部社友',subtitle:'正在一起筹备秋季活动，尚未发起引荐。',tags:['资源：活动空间'],contact:'jianghe@example.invalid'},
  {id:'o1',name:'大桥读书会',kind:'org',member:false,relation:'组织交流',subtitle:'围绕阅读与地方生活保持长期交流。',tags:['活动方向：阅读讨论'],contact:'bridge@example.invalid',ambassadors:['shen','he']}
 ],tasks:[task('review-lin','p1','audit','了解林澈的入社意愿'),task('onboard-cen','p2','onboarding','陪岑夏走完入社第一步','shen'),{...task('monthly-lu','p3','monthly','十月近况沟通'),month:'2026-10',deadline:'2026-10-10T18:00:00+08:00'},task('cooperate-bridge','o1','cooperation','确认秋季共读安排','zhou'),failed],notes:[{id:'n1',personId:'p1',body:'9 月 28 日，林澈主动询问内容小组的协作方式，希望了解加入后的具体安排。已告知后续会有人联系。',authorId:'zhou',at:'2026-09-28T18:20:00+08:00'}],events:[stamp('已发起林澈的引荐，审核任务等待领取','周宁')],messages:[{id:'m1',ownerId:'zhou',personId:'o1',taskId:'cooperate-bridge',text:'共读安排即将到期，请核对进展或主动延期。',read:false}]};
}
export function applyFlow(data:FlowData,action:FlowAction,actor:FlowActor):FlowData{
 const next=structuredClone(data),at=next.now;
 const future=(value?:string)=>{if(!value||!Number.isFinite(Date.parse(value))||Date.parse(value)<=Date.parse(at))throw new Error('请选择晚于当前演示时间的期限。');return value;};
 const log=(text:string,t?:FlowTask,result?:string)=>{const e={...stamp(text,actor.name,at),result};next.events.unshift(e);t?.history.push(e);};
 const person=(id:string)=>{const p=next.people.find(p=>p.id===id);if(!p)throw new Error('档案不存在。');return p;};
 if(action.type==='read'){const m=next.messages.find(m=>m.id===action.messageId&&m.ownerId===actor.id);if(m)m.read=true;return next;}
 if(action.type==='note'){person(action.personId);if(!action.body.trim())throw new Error('请写下要留档的内容。');next.notes.unshift({id:crypto.randomUUID(),personId:action.personId,body:action.body.trim(),authorId:actor.id,at});log('新增档案观察');return next;}
 if(action.type==='refer'||action.type==='join'){
  const p=person(action.personId);if(p.kind!=='person')throw new Error('组织不适用入社流程。');
  if(action.type==='join'){
   if(p.member)return next;
   p.member=true;p.relation='社员';log(`${p.name}已正式入社，原档案与历史保留`);
   const t=task(crypto.randomUUID(),p.id,'onboarding',`陪${p.name}走完入社第一步`);t.deadline=new Date(Date.parse(at)+7*86400000).toISOString();t.history=[];next.tasks.unshift(t);log('入社对接已创建 · 待接手，未沿用审核负责人',t);
  }else{
   if(p.member)throw new Error('该对象已经是社员。');
   if(next.tasks.some(t=>t.personId===p.id&&t.type==='audit'&&t.open))return next;
   const t=task(crypto.randomUUID(),p.id,'audit',`了解${p.name}的入社意愿`);t.deadline=new Date(Date.parse(at)+7*86400000).toISOString();t.history=[];next.tasks.unshift(t);log('已发起新一轮引荐 · 审核等待领取',t);
  }return next;
 }
 const t=next.tasks.find(t=>t.id===action.taskId);if(!t)throw new Error('任务不存在。');
 if(action.type==='reopen'){
  if(t.open)throw new Error('任务已经开启。');
  if(t.ownerId!==actor.id&&actor.role!=='admin')throw new Error('仅原接取者或管理员可以重新开启。');
  t.deadline=future(action.deadline);t.open=true;t.ownerId=t.ownerId===actor.id?actor.id:null;t.result=undefined;log(t.ownerId?'已重开，由本人继续负责；原关闭结果保留':'已重开为待领取；原关闭结果保留',t);return next;
 }
 if(!t.open)throw new Error('任务已关闭，重新开启后才能修改。');
 if(Date.parse(t.deadline)<=Date.parse(at))throw new Error('任务期限已到，请刷新到期结果并明确重新开启。');
 if(action.type==='claim'){
  if(t.ownerId)throw new Error('任务已被领取，请查看当前负责人。');
  t.ownerId=actor.id;t.deadline=new Date(Date.parse(at)+7*86400000).toISOString();log(`${actor.name}主动领取，成为当前负责人`,t);return next;
 }
 if(action.type==='comment'){
  if(!action.body?.trim())throw new Error('请填写评论。');
  t.comments.push({id:crypto.randomUUID(),authorId:actor.id,body:action.body.trim(),at});log('添加工作评论，期限保持不变',t);return next;
 }
 if(t.ownerId!==actor.id&&!(action.type==='cancel'&&actor.role==='admin'))throw new Error('只有当前负责人可以执行此操作。');
 if(action.type==='extend'){const deadline=future(action.deadline);if(Date.parse(deadline)<=Date.parse(t.deadline))throw new Error('延期须晚于原期限。');log(`主动延期：${t.deadline.slice(0,10)} → ${deadline.slice(0,10)}`,t);t.deadline=deadline;}
 if(action.type==='release'){t.ownerId=null;t.deadline=future(action.deadline);log('主动放弃，回到待领取，不记为失败',t);}
 if(action.type==='complete'||action.type==='cancel'){
  if(action.type==='complete'&&action.body?.trim()){
   const n={id:crypto.randomUUID(),personId:t.personId,body:action.body.trim(),authorId:actor.id,at};next.notes.unshift(n);t.noteIds.push(n.id);
  }
  t.open=false;t.result=action.type==='complete'?'completed':'cancelled';log(action.type==='complete'?'接取者确认完成，工作结果保留在档案':'任务取消，保留原因与历史',t,t.result);
  if(action.type==='cancel'&&action.body?.trim())log(action.body.trim(),t);
 }
 next.messages=next.messages.filter(m=>m.taskId!==t.id);return next;
}
export function advanceFlow(data:FlowData):FlowData{
 const next=structuredClone(data);next.now=new Date(Date.parse(next.now)+86400000).toISOString();
 for(const t of next.tasks.filter(t=>t.open)){
  if(Date.parse(t.deadline)<=Date.parse(next.now)){t.open=false;t.result=t.ownerId?'failed':'unclaimed';t.history.push({...stamp(t.ownerId?'到期未完成':'到期无人接取','系统',next.now),result:t.result});next.messages=next.messages.filter(m=>m.taskId!==t.id);}
  else if(t.ownerId&&Date.parse(t.deadline)-Date.parse(next.now)<=86400000&&!next.messages.some(m=>m.taskId===t.id))next.messages.push({id:crypto.randomUUID(),ownerId:t.ownerId,personId:t.personId,taskId:t.id,text:`${t.title}将在一天内到期。`,read:false});
 }return next;
}
