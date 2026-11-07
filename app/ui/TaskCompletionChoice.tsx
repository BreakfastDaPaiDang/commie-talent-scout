import React from 'react';
import {personnelDeliveryKind,taskCompletionOptions,taskCompletionEffect} from '../rules/task-delivery';

export function TaskCompletionChoice({task,value,onChange}:{task:{archive_id:string|null;kind:string;source?:string;requires_observation_reference?:boolean};value:string;onChange:(value:string)=>void}){
 const effect=taskCompletionEffect(task,value);
 return <><label>完成结果<select aria-label="完成结果" required value={value} onChange={e=>onChange(e.target.value)}>{personnelDeliveryKind(task)&&<option value="" disabled>请选择交付结论</option>}{taskCompletionOptions(task).map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{effect&&<p className="task-defaults" role="status">{effect}</p>}</>;
}
