import {api} from './api';
import type {InternalResourceAdapter} from '../ui/InternalResources';
import type {InternalResource} from '../shared/internal-resources';
export const internalResourceAdapter:InternalResourceAdapter={
 list:(query,state,offset=0)=>api('/internal-resources?'+new URLSearchParams({query,state,offset:String(offset),limit:'30'})),
 get:async id=>(await api<{resource:InternalResource}>('/internal-resources/'+id)).resource,
 save:input=>api('/internal-resources/save',input),receipt:id=>api('/commands/'+id),
 members:async()=>{let cursor:string|null=null;const members:{id:string;name:string;frozen:boolean;identity_kind?:string}[]=[];do{const r: {members:typeof members;next_cursor:string|null}=await api('/members?'+new URLSearchParams({limit:'100',...(cursor?{before:cursor}:{})}));members.push(...r.members);cursor=r.next_cursor;}while(cursor);return members.filter(m=>m.identity_kind!=='service');},
};
