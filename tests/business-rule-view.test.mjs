import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID as uuid} from 'node:crypto';
import {renderBusinessRules} from '../scripts/generate-business-rules.mjs';
import {archiveStatePolicy} from '../app/shared/archive-states.ts';
import {archiveTransitionRules} from '../app/server/rules/archive-lifecycle.ts';
import {Archives} from '../app/server/archives.ts';
import {fixture} from './d1-fixture.mjs';

test('checked-in view is generated from executable definitions',()=>{
 assert.equal(readFileSync(new URL('../docs/generated/archive-rules.md',import.meta.url),'utf8').replace(/\r\n/g,'\n'),renderBusinessRules());
});
test('changing the executed policy, condition or effect changes both real service behavior and the view',async t=>{
 const f=fixture();t.after(f.close);const s=new Archives(f.env,f.actor,'web');
 const make=()=>s.create({type:'person',name:'虚构规则来源',request_id:uuid()});
 const transition=(a,status)=>s.setState({id:a.id,expected_version:1,status,member_ids:[],request_id:uuid()});
 const policy=archiveStatePolicy.find(p=>p.status==='已入伙'),closing=archiveTransitionRules.find(r=>r.id==='close'),reopening=archiveTransitionRules.find(r=>r.id==='reopen');
 const original={closed:policy.closed,when:closing.when,apply:closing.apply},view=renderBusinessRules();
 try{
  policy.closed=!original.closed;
  const changedJoined=await transition(await make(),'已入伙');
  assert.equal(changedJoined.closed,policy.closed);
  assert.notEqual(renderBusinessRules(),view);assert.match(renderBusinessRules(),/已入伙 \| 人物 \| 是/);
  policy.closed=original.closed;
  closing.when=reopening.when;
  const skipped=await transition(await make(),'已弃用');
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM archive_events WHERE archive_id=? AND kind='archive.closed'").get(skipped.id).n,0);
  assert.notEqual(renderBusinessRules(),view);assert.match(renderBusinessRules(),/\| close \| \[reopensArchive\]/);
  closing.when=original.when;closing.apply=reopening.apply;
  const changed=await transition(await make(),'已弃用');
  assert.equal(f.sqlite.prepare("SELECT count(*) n FROM archive_events WHERE archive_id=? AND kind='archive.reopened'").get(changed.id).n,1);
  assert.notEqual(renderBusinessRules(),view);assert.match(renderBusinessRules(),/\| close \| .*\[recordReopening\]/);
 }finally{policy.closed=original.closed;closing.when=original.when;closing.apply=original.apply;}
 assert.equal(renderBusinessRules(),view);
});
