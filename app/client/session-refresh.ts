import {api,ApiError,type Member} from './api';

// Re-check restored pages without letting an old request overwrite a newer login.
export function watchSession(onResult:(member:Member|null,restored:boolean)=>void){
 let stopped=false,sequence=0,lastCheck=0;
 async function check(restored:boolean){
  if(document.visibilityState==='hidden'||(!restored&&Date.now()-lastCheck<1000))return;
  lastCheck=Date.now();const current=++sequence;
  try{
   let member:Member|null;
   try{member=(await api<{member:Member}>('/auth/me')).member;}
   catch(error){if(error instanceof ApiError&&error.status===401)member=null;else throw error;}
   if(!stopped&&current===sequence)onResult(member,restored);
  }catch{/* A transport failure does not prove that a session has expired. */}
 }
 const shown=(event:PageTransitionEvent)=>{if(event.persisted)void check(true);};
 const visible=()=>{if(document.visibilityState==='visible')void check(false);};
 window.addEventListener('pageshow',shown);document.addEventListener('visibilitychange',visible);
 return()=>{stopped=true;sequence++;window.removeEventListener('pageshow',shown);document.removeEventListener('visibilitychange',visible);};
}
