import {personStates,isClosedState,archiveStateLabel} from '../rules/archive-states.ts';
export const internalResourceStages=personStates.filter(s=>!isClosedState(s)).map(id=>({id,title:id==='已入伙'?'社员与建设':archiveStateLabel(id)}));
export type InternalResource={id:string;version:number;name:string;type:string;note:string;stage_ids:string[];status:'accepting'|'paused'|'archived';capacity:number|null;member_ids:string[];members:{id:string;name:string;frozen:boolean}[];used:number;planned:number;remaining:number|null;projected_remaining?:number|null;overplanned?:number;created_by:string;created_at:string;updated_at:string};
export type InternalResourceInput=Pick<InternalResource,'name'|'type'|'note'|'stage_ids'|'status'|'capacity'|'member_ids'>&{id:string|null;expected_version:number;request_id:string};
export const resourceStatuses={accepting:'开放承接',paused:'暂停新增承接',archived:'已停用'} as const;
