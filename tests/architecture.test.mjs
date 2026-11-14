import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceDependencies,dependencyCycles,boundaryViolation} from '../scripts/check-architecture.mjs';

test('dependency checks distinguish type-only imports and reexports from runtime dependencies',()=>{
  const dependencies=sourceDependencies(`import type {A} from './types'; import {type B} from './other'; export type {C} from './contract'; export {Button} from './button'; import './style.css';`);
  assert.deepEqual(dependencies.map(d=>[d.path,d.typeOnly]),[['./types',true],['./other',true],['./contract',true],['./button',false],['./style.css',false]]);
});

test('shared dependencies are allowed while an actual return path is reported',()=>{
  const graph=new Map([['page',['modal','share']],['share',['modal']],['modal',['button']],['button',[]]]);
  assert.deepEqual(dependencyCycles(graph),[]);
  graph.set('button',['page']);
  assert.ok(dependencyCycles(graph).some(cycle=>cycle[0]==='page'&&cycle.at(-1)==='page'));
});

test('browser and shared contracts cannot acquire implementation dependencies, and internal services cannot call their facade',()=>{
  assert.ok(boundaryViolation('app/client/Tasks.tsx','app/server/work-tasks.ts',false));
  assert.ok(boundaryViolation('app/shared/tasks.ts','app/server/work-tasks.ts',true));
  assert.ok(boundaryViolation('app/server/work-tasks/queries.ts','app/server/work-tasks.ts',true));
  assert.ok(boundaryViolation('app/ui/Modal.tsx','app/client/api.ts',false));
  assert.equal(boundaryViolation('app/client/Tasks.tsx','app/shared/work-tasks.ts',true),null);
});
