export type Identity={id:string;name:string;username:string;role:'member'|'admin';eligible:boolean;membership_id:string|null;verified_at:string;environment:string};
export type Env={KNOWLEDGE_DB:D1Database;IDENTITY:Fetcher;ENVIRONMENT:'staging'|'production';IDENTITY_ORIGIN:string;APP_ORIGIN:string};
export class KnowledgeError extends Error{
 constructor(readonly status:number,readonly code:string,message:string){super(message);}
}
export const uid=()=>crypto.randomUUID();
export const now=()=>new Date().toISOString();
export async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}
export function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
