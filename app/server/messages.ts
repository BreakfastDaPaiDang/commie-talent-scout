import {z} from 'zod';
import {NotificationQuery} from './notification-query.ts';
import type {Actor,Env} from './types.ts';
export const messageListInput=z.object({unread:z.union([z.boolean(),z.enum(['true','false'])]).transform(v=>v===true||v==='true').default(false),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict();
export const messageReadInput=z.object({ids:z.array(z.union([z.uuid(),z.string().regex(/^[0-9a-f]{32}$/i)])).min(1).max(100)}).strict();
// Legacy HTTP/MCP shape only; shared queries and read state are authoritative.
export class Messages{
 private query:NotificationQuery;
 constructor(env:Env,actor:Actor){this.query=new NotificationQuery(env,actor);}
 async list(input:unknown={}){const a=messageListInput.parse(input),r=await this.query.list({...a,source:'task'});return {messages:r.notifications.map(n=>({...n.data,read:n.read}))};}
 async summary(){return {total:(await this.query.summary()).messages};}
 async markRead(input:unknown){return this.query.markTasks(messageReadInput.parse(input).ids);}
}
