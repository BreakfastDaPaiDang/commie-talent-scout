// Executable archive policy shared by the 1.0.0 web/MCP integration.
export const archiveStatePolicy=[
 {status:'视奸观察',types:['person','org'],closed:false,requiresMembers:false},
 {status:'个人接触',types:['person','org'],closed:false,requiresMembers:false},
 {status:'引荐中（待人事组接触）',types:['person'],closed:false,requiresMembers:true},
 {status:'人事审核',types:['person'],closed:false,requiresMembers:true},
 {status:'已加入待对接',types:['person'],closed:false,requiresMembers:true},
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
