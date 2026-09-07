// Throwaway, fictional in-memory fixtures. No account or business service is called.
export const personStates = ['视奸观察', '个人接触', '引荐中（待人事组接触）', '人事审核', '已加入待对接', '已入伙', '已弃用'];
export const orgStates = ['视奸观察', '个人接触', '组织交流', '已弃用'];
export const isClosed = state => ['已入伙', '已弃用'].includes(state);
export const uuid = () => crypto.randomUUID();
export const stamp = () => new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const initialMembers = [
  {id:'zhou', name:'周宁', username:'zhouning', role:'admin', frozen:false},
  {id:'shen', name:'沈舟', username:'shenzhou', role:'member', frozen:false},
  {id:'xu', name:'许禾', username:'xuhe', role:'member', frozen:true},
];
const record = (id, author, time, body, extra={}) => ({id, author, time, body, deleted:false, images:[], versions:[{body, time, actor:author, operation:'创建'}], ...extra});
export const initialEntities = [
 {id:'p1', type:'person', name:'林川', alias:'山间', state:'个人接触', owners:{'个人接触':['zhou','shen']}, intro:'关注社区协作与内容策划。最近在参与青年公共空间的日常运营。', contacts:[{type:'微信',value:'shanjian_demo',note:'虚构示例'}], updated:'09-07 14:32', unread:true, records:[
  record('r1','zhou','09-07 14:32','今天聊了社区内容协作。表达清晰，也愿意承担具体任务。\n\n可以先一起做一次小型活动，再观察协作方式。当前的判断主要来自这次交流，还需要具体合作来验证。'),
  record('r2','shen','09-06 16:48','初步沟通，了解了过往的内容策划经历。对社区协作有自己的理解，能够把抽象的想法落到具体分工上。\n\n约定下周一起复盘一次活动案例，再讨论适合从哪里开始参与。'),
 ], events:[{id:'e1',kind:'system',actor:'shen',time:'09-06 18:10',text:'将业务状态从「视奸观察」改为「个人接触」'}]},
 {id:'p2',type:'person',name:'叶宁',alias:'一叶',state:'视奸观察',owners:{},intro:'做过一些社区影像记录，愿意分享素材整理经验。',contacts:[],updated:'09-07 11:08',unread:true,records:[record('r3','shen','09-07 11:08','内容敏感度高，对细节有要求。还需要更多背景信息佐证，暂时保持观察。')],events:[]},
 {id:'p3',type:'person',name:'周野',alias:'',state:'引荐中（待人事组接触）',owners:{'引荐中（待人事组接触）':['zhou']},intro:'活跃于几个小型社区，有一些线下活动的组织经验。',contacts:[],updated:'09-06 18:20',unread:false,records:[record('r4','zhou','09-06 18:20','已经介绍给人事组。此前合作中响应及时，接下来可以了解对长期协作的预期。')],events:[]},
 {id:'p4',type:'person',name:'陈榆',alias:'小榆',state:'人事审核',owners:{'人事审核':['shen']},intro:'关注教育与知识整理，有持续写作的习惯。',contacts:[],updated:'09-06 16:12',unread:false,records:[record('r5','shen','09-06 16:12','有持续学习的投入，也能比较具体地描述自己的不足。约定再聊一次，补充经历细节。')],events:[]},
 {id:'p5',type:'person',name:'陆遥',alias:'',state:'已弃用',lastOpenState:'个人接触',owners:{'个人接触':['zhou']},intro:'此前一起参加过一次公开活动。',contacts:[],updated:'09-05 09:40',unread:false,records:[record('r6','zhou','09-05 09:40','当前方向不匹配，暂不考虑后续协作。保留此前的交流记录。')],events:[{id:'e2',kind:'system',actor:'zhou',time:'09-05 09:41',text:'将业务状态改为「已弃用」，并关闭档案'}]},
 {id:'o1',type:'org',name:'北岸公共空间',alias:'北岸',state:'组织交流',owners:{'组织交流':['zhou','shen']},intro:'一个围绕社区公共议题开展活动的小型空间。',contacts:[{type:'邮箱',value:'hello@example.org',note:'虚构示例'}],updated:'09-07 10:06',unread:true,records:[record('r7','zhou','09-07 10:06','交流了共同举办读书讨论的可能性。空间可以支持小型活动，需要进一步确认场地时间和参与方式。')],events:[]},
 {id:'o2',type:'org',name:'微光写作小组',alias:'微光',state:'视奸观察',owners:{},intro:'关注日常生活与社区经验的写作小组。',contacts:[],updated:'09-06 15:40',unread:false,records:[record('r8','shen','09-06 15:40','最近几篇文章有不少具体观察。先持续阅读，了解他们正在讨论什么。')],events:[]},
];

// Static fictional September dates; new UI operations use real millisecond ordering.
export function timelineOrder(item){
 if(item.order)return item.order;
 const time=item.time; const d=new Date(); d.setHours(0,0,0,0);
 if(time.startsWith('今天'))d.setDate(d.getDate()-1);
 else if(time.startsWith('昨天'))d.setDate(d.getDate()-2);
 else {const [month,day]=time.split(' ')[0].split('-').map(Number);d.setMonth(month-1,day);}
 const [hour,minute]=time.split(' ').at(-1).split(':').map(Number);d.setHours(hour,minute);return +d;
}
const sampleImage={url:'/fixture-activity.svg',name:'虚构活动分工草图'};
const sampleRecord=initialEntities.find(e=>e.id==='o1').records[0];
sampleRecord.images=[sampleImage];sampleRecord.versions[0].images=[sampleImage];
