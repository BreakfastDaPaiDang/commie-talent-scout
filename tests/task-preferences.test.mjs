import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesPreference,normalizePreference,pushCandidates,pushDue,pushStage,shouldEscalate} from '../app/shared/task-preferences.ts';

const created='2026-10-01T00:00:00.000Z';
const task=(kind='audit',patch={})=>({id:'task',kind,open:true,ownerId:null,createdAt:created,...patch});
const member=(id,name,preference,patch={})=>({id,name,frozen:false,preference,...patch});

test('matching uses explicit inclination or all-work preference and never treats custom work as matched',()=>{
 assert.equal(matchesPreference({memberId:'a',all:false,kinds:['audit']},'audit'),true);
 assert.equal(matchesPreference({memberId:'a',all:false,kinds:['audit']},'monthly'),false);
 assert.equal(matchesPreference({memberId:'a',all:true,kinds:[]},'cooperation'),true);
 assert.equal(matchesPreference({memberId:'a',all:true,kinds:[]},'custom'),false);
 assert.equal(matchesPreference(null,'audit'),false);
 assert.deepEqual(normalizePreference({all:false,kinds:['monthly','audit','audit']}),{all:false,kinds:['audit','monthly']});
});

test('candidate list excludes frozen members, keeps no owner requirement, and has stable order',()=>{
 const candidates=pushCandidates(task(),[
  member('z','张三',{memberId:'z',all:false,kinds:['audit']}),
  member('a','阿宁',{memberId:'a',all:true,kinds:[]}),
  member('f','方某',{memberId:'f',all:true,kinds:[]},{frozen:true}),
  member('n','无倾向',null),
 ]);
 assert.deepEqual(candidates.map(m=>m.id),['a','z']);
 assert.deepEqual(pushCandidates(task('custom'),[member('a','阿宁',{memberId:'a',all:true,kinds:[]})]),[]);
 assert.deepEqual(pushCandidates(task('audit',{ownerId:'a'}),[member('a','阿宁',{memberId:'a',all:true,kinds:[]})]),[]);
});

test('push schedule sends initial and day-three reminder, then escalates without assigning',()=>{
 assert.equal(pushStage(task(),'2026-10-01T00:00:00.000Z'),'initial');
 assert.equal(pushDue(task(),'2026-10-01T12:00:00.000Z'),true);
 assert.equal(pushDue(task(),'2026-10-02T00:00:00.000Z'),false);
 assert.equal(pushStage(task(),'2026-10-04T00:00:00.000Z'),'reminder');
 assert.equal(pushDue(task(),'2026-10-04T00:00:00.000Z'),true);
 assert.equal(pushStage(task(),'2026-10-08T00:00:00.000Z'),'admin');
 assert.equal(shouldEscalate(task(),'2026-10-08T00:00:00.000Z'),true);
 const claimed=task('audit',{ownerId:'member'});assert.equal(pushStage(claimed,'2026-10-08T00:00:00.000Z'),'admin');assert.equal(pushDue(claimed,'2026-10-01T00:00:00.000Z'),false);
});
