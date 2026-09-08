import {useSyncExternalStore} from 'react';
import {api,ApiError} from './api';
type Draft={body:string;occurred_at:string|null;version:number;publish_request_id:string;updated_at:string};
type Snapshot={body:string;occurred_at:string|null;version:number;publishId:string|null;publishedId:string|null;loaded:boolean;phase:'loading'|'saved'|'saving'|'unsaved'|'error';error:string;dirty:boolean};
type Save={archive_id:string;expected_version:number;body:string;occurred_at:string|null;request_id:string};
const stores=new Map<string,DraftStore>();
const changed=()=>window.dispatchEvent(new Event('cts-drafts-changed'));
class DraftStore{
 private state:Snapshot={body:'',occurred_at:null,version:0,publishId:null,publishedId:null,loaded:false,phase:'loading',error:'',dirty:false};
 private listeners=new Set<()=>void>();private timer:ReturnType<typeof setTimeout>|undefined;private running:Promise<void>|undefined;private loading:Promise<void>|undefined;private pending:Save|null=null;
 constructor(readonly actorId:string,readonly archiveId:string){}
 snapshot=()=>this.state;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};
 private update(patch:Partial<Snapshot>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());changed();}
 load(force=false){
  if(this.loading)return this.loading;if(this.state.loaded&&!force)return Promise.resolve();
  this.loading=(async()=>{try{const r=await api<{draft:Draft|null;published:{id:string}|null}>('/drafts/'+this.archiveId);if(this.state.dirty&&!force)return;this.pending=null;this.update({body:r.draft?.body??'',occurred_at:r.draft?.occurred_at??null,version:r.draft?.version??0,publishId:r.draft?.publish_request_id??null,publishedId:r.published?.id??null,loaded:true,phase:'saved',error:'',dirty:false});}catch(e){this.update({loaded:false,phase:'error',error:(e as Error).message});throw e;}finally{this.loading=undefined;}})();return this.loading;
 }
 edit(patch:Partial<Pick<Snapshot,'body'|'occurred_at'>>){this.update({...patch,dirty:true,phase:'unsaved',error:'',publishedId:null});clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush().catch(()=>{}),650);}
 flush():Promise<void>{
  clearTimeout(this.timer);if(this.running)return this.running;if(!this.state.dirty&&!this.pending)return Promise.resolve();
  this.running=(async()=>{try{
   while(this.state.dirty||this.pending){
    const payload=this.pending??{archive_id:this.archiveId,expected_version:this.state.version,body:this.state.body,occurred_at:this.state.occurred_at,request_id:crypto.randomUUID()};this.pending=payload;this.update({phase:'saving',error:''});
    const result=await api<{version:number;publish_request_id:string}>('/drafts/save',payload);this.pending=null;
    const dirty=this.state.body!==payload.body||this.state.occurred_at!==payload.occurred_at;this.update({version:result.version,publishId:result.publish_request_id,dirty,phase:dirty?'unsaved':'saved'});
   }
  }catch(e){if(e instanceof ApiError&&e.status<500)this.pending=null;this.update({phase:'error',error:(e as Error).message});throw e;}finally{this.running=undefined;}})();return this.running;
 }
 async discardLocal(){clearTimeout(this.timer);if(this.running)await this.running.catch(()=>{});await this.load(true);}
 async clearPublished(){this.edit({body:'',occurred_at:null});await this.flush();}
}
export function useObservationDraft(actorId:string,archiveId:string){const key=actorId+':'+archiveId;let store=stores.get(key);if(!store){store=new DraftStore(actorId,archiveId);stores.set(key,store);}return {store,draft:useSyncExternalStore(store.subscribe,store.snapshot)};}
export async function flushDrafts(actorId:string){for(const store of stores.values())if(store.actorId===actorId)await store.flush();}
export function clearDraftMemory(actorId:string){for(const [key,store] of stores)if(store.actorId===actorId)stores.delete(key);}
window.addEventListener('beforeunload',event=>{if([...stores.values()].some(s=>s.snapshot().dirty)){event.preventDefault();event.returnValue='';}});
