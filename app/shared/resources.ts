export type Resource={id:string;version:number;name:string;kind:string;purposes:string[];capacity:number|null;active:boolean;deleted?:boolean;note:string};
export type ResourceSave={entity:'resource'|'resource_delete';id:string;expected_version:number;[key:string]:unknown};
const legacyPurposes:Record<string,string>={contact:'接触',review:'审核',onboarding:'对接',member:'社员',friend:'社外联系'};
export function resourcePurposes(values:string[]){return [...new Set(values.map(v=>legacyPurposes[v]??v.trim()).filter(Boolean))];}
