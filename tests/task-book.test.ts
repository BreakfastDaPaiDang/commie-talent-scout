import test from 'node:test';
import assert from 'node:assert/strict';
import {personalTaskCompletions,monthStartInBeijing} from '../app/rules/task-book.ts';

test('personal completions use Beijing completion month and exclude other owners and unfinished closures',()=>{
 const at=Date.parse('2026-10-12T10:00:00Z');
 const row={id:'task',status:'completed',owner_id:'me',created_at:'2026-01-01T00:00:00Z',completed_at:'2026-10-01T00:00:00Z',priority:'P1'};
 const tasks=[row,{...row,id:'month-boundary',priority:'P0',completed_at:'2026-09-30T16:00:00Z'},
  {...row,id:'previous-month',completed_at:'2026-09-30T15:59:59Z'},
  {...row,id:'other',owner_id:'other'},
  ...['open','cancelled','expired'].map(status=>({...row,id:status,status})),
  {...row,id:'missing-date',completed_at:null},{...row,id:'invalid-date',completed_at:'invalid'},
  {...row,id:'future',completed_at:'2026-11-01T00:00:00Z'}];
 assert.equal(monthStartInBeijing(at),Date.parse('2026-09-30T16:00:00Z'));
 assert.deepEqual(personalTaskCompletions(tasks,'me',at),{month:2,total:3,p0:1,p1:1});
 assert.deepEqual(personalTaskCompletions([],'me',at),{month:0,total:0,p0:0,p1:0});
 assert.equal(monthStartInBeijing(Date.parse('2026-12-31T16:00:00Z')),Date.parse('2026-12-31T16:00:00Z'));
});
