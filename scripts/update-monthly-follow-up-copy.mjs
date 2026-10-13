import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {verificationClient} from './verification-client.mjs';
import {memberMonthlyCopy,memberMonth,canRefreshMemberMonthlyCopy} from '../app/rules/member-monthly-follow-up.ts';
const apply=process.argv.includes('--apply'),production=process.argv.includes('--production'),v=await verificationClient('monthly-copy-update',{environment:production?'production':'staging'}),period=memberMonth(new Date().toISOString()).key;
const eligible=t=>canRefreshMemberMonthlyCopy(t,period);
const report={period,apply,target:v.target,candidates:[],updated:[],skipped:[]};
try{
 let offset=0;const tasks=[];while(offset!==null){const page=await v.call('list_work_tasks',{state:'open',scope:'all',limit:100,offset});tasks.push(...page.tasks);offset=page.next_offset;}
 for(const t of tasks){if(!eligible(t))continue;report.candidates.push(t.id);if(!apply)continue;const {task}=await v.call('get_work_task',{id:t.id});if(!eligible(task)){report.skipped.push(t.id);continue;}
  const result=await v.call('edit_work_task',{id:t.id,expected_version:task.version,...memberMonthlyCopy,request_id:randomUUID()});const after=(await v.call('get_work_task',{id:t.id})).task;assert.equal(after.purpose,memberMonthlyCopy.purpose);assert.equal(after.delivery,memberMonthlyCopy.delivery);for(const key of ['status','owner_id','deadline_at','priority','title'])assert.equal(after[key],task[key]);assert.deepEqual(after.label_keys,task.label_keys);report.updated.push({id:t.id,before_version:task.version,version:result.version});
 }
 mkdirSync('tmp/verification',{recursive:true});writeFileSync(`tmp/verification/monthly-copy-${v.target}-${apply?'apply':'preview'}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({period,target:v.target,apply,candidates:report.candidates.length,updated:report.updated.length,skipped:report.skipped.length}));
}finally{await v.close([`${period}: ${report.updated.length} unchanged-template open monthly tasks updated; ${report.skipped.length} concurrent changes skipped`]);}
