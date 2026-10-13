import {taskLabelNames} from './task-policy.ts';
// Label identity is independent of automation provenance and never triggers a workflow.
export const taskLabelKey=(value:string)=>Object.entries(taskLabelNames).find(([key,name])=>key===value.trim().toLowerCase()||name===value.trim())?.[0]??value.normalize('NFKC').trim().toLowerCase();
export const taskLabelKeys=(values:readonly string[])=>[...new Set(values.map(taskLabelKey).filter(Boolean))];
export const taskLabelDisplay=(value:string)=>taskLabelNames[taskLabelKey(value) as keyof typeof taskLabelNames]??value.trim();
export function taskMatchesLabels(keys:readonly string[],selected:readonly string[]){const canonical=taskLabelKeys(keys);return !selected.length||selected.some(key=>canonical.includes(taskLabelKey(key)));}
