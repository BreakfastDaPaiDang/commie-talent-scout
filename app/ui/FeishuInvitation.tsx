import React,{useEffect,useState} from 'react';
import {Modal} from './Modal';
import {feishuInvitation,feishuInvitationExpired} from '../shared/feishu-invitation';
import './feishu-invitation.css';

export function FeishuInvitation({onClose,invitation=feishuInvitation}:{onClose:()=>void;invitation?:typeof feishuInvitation}){
 const [at,setAt]=useState(Date.now),[failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[invitation.imageSrc]);
 const expired=feishuInvitationExpired(at,invitation.expiresAt);
 useEffect(()=>{
  const update=()=>setAt(Date.now()),remaining=Date.parse(invitation.expiresAt)-Date.now();
  const timer=Number.isFinite(remaining)&&remaining>0?window.setTimeout(update,Math.min(remaining,86400000)):undefined;
  window.addEventListener('focus',update);document.addEventListener('visibilitychange',update);
  return()=>{if(timer!==undefined)window.clearTimeout(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update);};
 },[at,invitation.expiresAt]);
 return <Modal title="加入飞书" onClose={onClose}><div className="feishu-invitation">
  {expired?<p role="status">已经过期，找神棍和散言更新</p>:failed||!invitation.imageSrc?<p role="status">二维码暂不可用，找神棍和散言更新</p>:<><svg className="feishu-qr" viewBox={invitation.frame?.viewBox??"0 0 480 480"} role="img" aria-label="飞书入职邀请二维码"><image href={invitation.imageSrc} width={invitation.frame?.width??480} height={invitation.frame?.height??480} onError={()=>setFailed(true)}/></svg><p>入职成功，请引入飞书</p></>}
 </div><div className="feishu-invitation-actions"><button type="button" className="button primary" onClick={onClose}>知道了</button></div></Modal>;
}
