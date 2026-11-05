export const resourceUsages={available:'可用资源',planned:'计划使用',active:'实际使用'} as const;
export type ResourceUsage=keyof typeof resourceUsages;
export type ResourceValue={id:string;name:string;type:string;note:string;archive_id:string|null;usage:ResourceUsage};
export type ResourceReference={id:string;name:string;type:'person'|'org';status:string;person_role:'member'|'external'|null;closed:boolean};
export type ArchiveResource=ResourceValue&{linked_archive?:ResourceReference|null;restricted?:false};
export type HiddenResource={id:string;restricted:true};
export type ResourceEntry=ArchiveResource|HiddenResource;
export function resourceInput(value:ResourceEntry){if(value.restricted)return {id:value.id,restricted:true as const};const {id,name,type,note,archive_id,usage}=value;return {id,name,type,note,archive_id,usage};}
