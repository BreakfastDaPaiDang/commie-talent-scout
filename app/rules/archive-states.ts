// Executable archive policy shared by the 1.0.0 web/MCP integration.
export const archiveStatePolicy=[
 {status:'视奸观察',types:['person','org'],closed:false,requiresMembers:false},
 {status:'个人接触',types:['person','org'],closed:false,requiresMembers:false},
 {status:'引荐中（待人事组接触）',types:['person'],closed:false,requiresMembers:true},
 {status:'人事审核',types:['person'],closed:false,requiresMembers:false},
 {status:'已加入待对接',types:['person'],closed:false,requiresMembers:false},
 {status:'已入伙',types:['person'],closed:false,requiresMembers:false},
 {status:'外部社友',types:['person'],closed:false,requiresMembers:false},
 {status:'组织交流',types:['org'],closed:false,requiresMembers:true},
 {status:'已弃用',types:['person','org'],closed:true,requiresMembers:false},
] as const;
const policyFor=(type:'person'|'org')=>archiveStatePolicy.filter(p=>(p.types as readonly string[]).includes(type));
export const personStates=policyFor('person').map(p=>p.status);
export const orgStates=policyFor('org').map(p=>p.status);
export const statesFor=(type:'person'|'org')=>type==='person'?personStates:orgStates;
export const isClosedState=(status:string)=>archiveStatePolicy.some(p=>p.status===status&&p.closed);
export const isWorkState=(type:'person'|'org',status:string)=>policyFor(type).some(p=>p.status===status&&p.requiresMembers);
export const memberLabel=(type:'person'|'org',status:string)=>isWorkState(type,status)?type==='person'?'人事负责':'工作负责':'关联成员';
export const memberStatuses=['已入伙'] as const;
export type PersonScope='all'|'external'|'members';
export const isMemberStatus=(status:string)=>(memberStatuses as readonly string[]).includes(status);
export const memberBasicStates=['可接工作','请假','失联'] as const;
export type MemberBasicState=typeof memberBasicStates[number];
export type PersonRole='external'|'member';
export type PersonIdentity={type?:string;status:string;person_role?:PersonRole|null;member_status?:MemberBasicState|null};
export const isMemberArchive=(a:PersonIdentity)=>a.type!=='org'&&(a.person_role?a.person_role==='member':isMemberStatus(a.status));
// Keep the persisted/API key stable while making the approval prerequisite explicit.
export const archiveStateLabel=(status:string)=>status==='已加入待对接'?'审核通过（待对接）':status;
export const archiveDisplayStatus=(a:PersonIdentity)=>isMemberArchive(a)?a.member_status??'可接工作':archiveStateLabel(a.status);
export const archivePath=(a:PersonIdentity)=>a.type==='org'?'/organizations':isMemberArchive(a)?'/members':'/';

// A UI shortcut is a projection of the existing state command, not another workflow.
export function archivePrimaryAction(a:PersonIdentity&{closed?:boolean;deleted?:boolean}){
 if(a.type!=='person'||a.closed||a.deleted||isMemberArchive(a))return null;
 if(['视奸观察','个人接触','外部社友','引荐中（待人事组接触）'].includes(a.status))return {label:'提交人事审核',status:'人事审核',effect:'将创建待领取的人事审核任务。'};
 if(a.status==='人事审核')return {label:'审核通过（创建入社对接任务）',status:'已加入待对接',effect:'确认已通过人事审核，将创建入社对接任务。完成对接后再转为社员。'};
 if(a.status==='已加入待对接')return {label:'确认已入伙',status:'已入伙',effect:'将移入社员页面，保留同一份档案和历史。'};
 return null;
}
