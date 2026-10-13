import React from 'react';
import {TaskLabelPicker,type TaskLabelPage,type TaskLabelOption} from '../ui/TaskLabelPicker';
import {api} from './api';
import {taskLabelNames} from '../rules/task-policy';
const search=(query:string,offset:number)=>api<TaskLabelPage>('/work-task-labels?'+new URLSearchParams({query,offset:String(offset),limit:'30'}));
const create=(name:string)=>api<TaskLabelOption>('/work-task-labels/create',{name,request_id:crypto.randomUUID()});
const builtin=Object.entries(taskLabelNames).map(([key,name])=>({key,name}));
export function TaskLabels({value,onChange,filter=false,initialOptions=[]}:{value:string[];onChange:(keys:string[])=>void;filter?:boolean;initialOptions?:TaskLabelOption[]}){return <TaskLabelPicker value={value} onChange={onChange} search={search} create={filter?undefined:create} filter={filter} initialOptions={[...builtin,...initialOptions]}/>;}
