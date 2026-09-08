export const personStates=['视奸观察','个人接触','引荐中（待人事组接触）','人事审核','已加入待对接','已入伙','已弃用'] as const;
export const orgStates=['视奸观察','个人接触','组织交流','已弃用'] as const;
export const statesFor=(type:'person'|'org')=>type==='person'?personStates:orgStates;
export const isClosedState=(status:string)=>status==='已入伙'||status==='已弃用';
export const isWorkState=(type:'person'|'org',status:string)=>type==='person'?['引荐中（待人事组接触）','人事审核','已加入待对接'].includes(status):status==='组织交流';
export const memberLabel=(type:'person'|'org',status:string)=>isWorkState(type,status)?type==='person'?'人事负责':'工作负责':'关联成员';
