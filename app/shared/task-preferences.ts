export const pushableTaskKinds=['audit','onboarding','monthly','cooperation'] as const;
export type PushableTaskKind=typeof pushableTaskKinds[number];
export type TaskKind=PushableTaskKind|'custom';

export type WorkPreference={
 memberId:string;
 all:boolean;
 kinds:readonly PushableTaskKind[];
};

export type CandidateMember={
 id:string;
 name:string;
 frozen:boolean;
 preference:WorkPreference|null;
};

export type PushableTask={
 id:string;
 kind:TaskKind;
 open:boolean;
 ownerId:string|null;
 createdAt:string;
};

export type PushStage='initial'|'reminder'|'admin';

const day=24*60*60*1000;
const pushDays=[0,3] as const;

export function normalizePreference(input:Pick<WorkPreference,'all'|'kinds'>):Pick<WorkPreference,'all'|'kinds'>{
 return {all:input.all,kinds:[...new Set(input.kinds)].sort()};
}

export function matchesPreference(preference:WorkPreference|null,kind:TaskKind){
 if(!preference||kind==='custom')return false;
 return preference.all||preference.kinds.includes(kind);
}

export function pushCandidates(task:PushableTask,members:readonly CandidateMember[]):CandidateMember[]{
 if(!task.open||task.ownerId)return [];
 return members.filter(member=>!member.frozen&&matchesPreference(member.preference,task.kind)).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans')||a.id.localeCompare(b.id));
}

export function pushStage(task:PushableTask,at:string):PushStage{
 if(!task.open||task.ownerId)return 'admin';
 const age=Date.parse(at)-Date.parse(task.createdAt);
 if(!Number.isFinite(age)||age<0)return 'initial';
 if(age>=7*day)return 'admin';
 if(age>=3*day)return 'reminder';
 return 'initial';
}

export function pushDue(task:PushableTask,at:string){
 if(!task.open||task.ownerId)return false;
 const age=Date.parse(at)-Date.parse(task.createdAt);
 return Number.isFinite(age)&&pushDays.includes(Math.floor(age/day) as 0|3);
}

export function shouldEscalate(task:PushableTask,at:string){return pushStage(task,at)==='admin';}
