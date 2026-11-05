import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildInteractionGraph} from '../app/rules/interaction-graph.ts';
import {personnelDeliveryResults} from '../app/rules/task-delivery.ts';
import {archiveTransitionRules} from '../app/rules/archive-lifecycle.ts';

test('checked-in graph reflects executed definitions and has valid, distinct relation semantics',async()=>{
 const graph=await buildInteractionGraph();assert.deepEqual(JSON.parse(readFileSync(new URL('../app/shared/interaction-graph.json',import.meta.url),'utf8')),graph);
 const ids=new Set(graph.nodes.map(n=>n.id));assert.equal(ids.size,graph.nodes.length);assert.equal(new Set(graph.rules.map(r=>r.id)).size,graph.rules.length);
 for(const r of graph.rules){assert.ok(ids.has(r.from)&&ids.has(r.to));assert.ok(r.trigger&&r.effects.length&&r.boundaries.length&&r.source);if(r.to==='statistics')assert.equal(r.kind,'query');}
 assert.equal(graph.rules.find(r=>r.id==='audit_passed').to,'archives');assert.ok(graph.rules.find(r=>r.id==='task.deadline').conditions.some(c=>c.includes('负责人')));
});

test('changing an executed personnel definition changes its graph projection, rather than a second independent rule table',async()=>{
 const original=personnelDeliveryResults.audit_passed.to,rule=archiveTransitionRules.find(r=>r.id==='personnel-task'),originalId=rule.id;
 try{
  personnelDeliveryResults.audit_passed.to='已入伙';const changed=await buildInteractionGraph();assert.ok(changed.rules.find(r=>r.id==='audit_passed').effects.some(t=>t.includes('已入伙')));
  rule.id='disabled-for-projection-test';const removed=await buildInteractionGraph();assert.equal(removed.rules.some(r=>r.id==='archive-audit'||r.id==='archive-onboarding'),false);
 }finally{personnelDeliveryResults.audit_passed.to=original;rule.id=originalId;}
});
