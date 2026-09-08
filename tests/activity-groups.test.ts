import test from 'node:test';
import assert from 'node:assert/strict';
import {groupActivities,type ActivityEvent} from '../app/shared/activity-groups.ts';
const event=(id:string,minute:number,actor='member',archive='archive'):ActivityEvent=>({id,archive_id:archive,actor_id:actor,created_at:new Date(Date.UTC(2026,8,8,12,minute)).toISOString(),kind:'archive.tags_changed'});
test('a five-minute operation batch is one presentation group and retains every event in order',()=>{
 const events=[event('state',5),event('tag2',4),{...event('body',3),kind:'observation.created'},event('tag1',2),event('created',0)];
 const groups=groupActivities(events);assert.equal(groups.length,1);assert.deepEqual(groups[0].events,events);assert.equal(groups[0].id,'state');
 assert.equal(groupActivities([...events,event('older',-1)]).length,2,'five-minute maximum span, not unbounded consecutive chaining');
});
test('different actors, archives and invalid times never combine; appending a page preserves group key and full content',()=>{
 const first=[event('a',5),event('b',4)],next=[event('c',3),event('d',2,'other'),event('e',1,'other','another')];
 assert.equal(groupActivities(first)[0].id,groupActivities([...first,...next])[0].id);assert.deepEqual(groupActivities([...first,...next]).map(g=>g.events.map(e=>e.id)),[['a','b','c'],['d'],['e']]);
 assert.equal(groupActivities([event('x',0),{...event('bad',0),created_at:'unknown'}]).length,2);
});
