import React, {useState} from 'react';
import {Icon} from './icons.jsx';
export function ContactFields({initial=[]}){
 const [rows,setRows]=useState(initial.map(c=>({...c,key:crypto.randomUUID()})));
 return <fieldset className="contact-fields"><legend>联系方式 <small>可选</small></legend>{rows.map((row,i)=><div className="contact-input-row" key={row.key}><select aria-label={`联系方式${i+1}类型`} name="contact-type" defaultValue={row.type}>{['QQ','微信','邮箱','电话','网站','其他'].map(t=><option key={t}>{t}</option>)}</select><input aria-label={`联系方式${i+1}`} name="contact-value" defaultValue={row.value} placeholder="填写联系方式"/><button type="button" className="icon-button" aria-label={`移除联系方式${i+1}`} onClick={()=>setRows(p=>p.filter(r=>r.key!==row.key))}><Icon name="close" size={15}/></button></div>)}<button className="add-contact" type="button" onClick={()=>setRows(p=>[...p,{key:crypto.randomUUID(),type:'QQ',value:''}])}><Icon name="plus" size={14}/>添加联系方式</button></fieldset>;
}
