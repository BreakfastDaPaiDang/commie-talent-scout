import {api} from './api';
type Notification<T>={id:string;source:'task'|'archive';read:boolean;data:T};
export async function notificationPage<T>(source:'task'|'archive',params:Record<string,string>={}){
 const r=await api<{notifications:Notification<T>[];snapshot:string;next_cursor:string|null}>('/notifications?'+new URLSearchParams({source,...params}));
 return {items:r.notifications.map(n=>({...n.data,read:n.read})),snapshot:r.snapshot,next_cursor:r.next_cursor};
}
