import test from 'node:test';
import assert from 'node:assert/strict';
import {planRules,type RuleModule} from '../app/server/rules/contract.ts';

test('planning preserves condition/effect order, skips unmatched effects and propagates failure before commit',()=>{
 const calls:string[]=[];
 const module:RuleModule<{fail:boolean},string>={
  id:'fixture',source:'fixture',triggers:[],
  verification:{transaction:{file:'fixture',entry:'commit'},guard:{file:'fixture',entry:'guard'},tests:[],idempotency:'fixture',failure:'fixture'},
  rules:[
   {id:'first',when:()=>{calls.push('when-first');return true;},apply:()=>{calls.push('plan-first');return ['guard','write'];}},
   {id:'skip',when:()=>false,apply:()=>{throw Error('must not run');}},
   {id:'last',when:()=>{calls.push('when-last');return true;},apply:c=>{if(c.fail)throw Error('planning failed');return ['history'];}},
  ],
 };
 const plan=planRules(module,{fail:false});
 assert.deepEqual(calls,['when-first','plan-first','when-last']);
 assert.deepEqual(plan.steps.map(s=>s.ruleId),['first','last']);
 assert.deepEqual(plan.statements,['guard','write','history']);
 assert.throws(()=>planRules(module,{fail:true}),/planning failed/);
});
