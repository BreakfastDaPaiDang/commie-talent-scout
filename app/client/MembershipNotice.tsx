import React,{useEffect,useRef,useState} from 'react';
import {FeishuInvitation} from '../ui/FeishuInvitation';
import type {MembershipResult} from '../shared/feishu-invitation';
const eventName='cts-membership-joined';
export function notifyMembershipJoined(result:MembershipResult,requestId:string){
 if(result.membership_joined===true)window.dispatchEvent(new CustomEvent(eventName,{detail:requestId}));
}
export function MembershipNotice(){
 const [open,setOpen]=useState(false),shown=useRef(new Set<string>());
 useEffect(()=>{const receive=(event:Event)=>{const id=(event as CustomEvent<unknown>).detail;if(typeof id!=='string'||shown.current.has(id))return;shown.current.add(id);setOpen(true);};window.addEventListener(eventName,receive);return()=>window.removeEventListener(eventName,receive);},[]);
 return open?<FeishuInvitation onClose={()=>setOpen(false)}/>:null;
}
