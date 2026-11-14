import test from 'node:test';
import assert from 'node:assert/strict';
import {primaryNavigation,resolveRoute} from '../app/client/navigation/routes.ts';

test('primary navigation retains all six pages and organizations opens its own route',()=>{
  const navigation=primaryNavigation('/organizations');
  assert.deepEqual(navigation.map(item=>item.title),['外部人物','组织','社员','任务','统计','知识库']);
  assert.equal(navigation.filter(item=>item.active).length,1);
  assert.equal(navigation.find(item=>item.active)?.path,'/organizations');
  for(const item of navigation)assert.equal(resolveRoute(item.path),item.id);
});

test('existing archive links, statistics subpage and unread alias retain their destinations',()=>{
  assert.equal(resolveRoute('/'),'people');
  assert.equal(primaryNavigation('/',true).find(item=>item.active)?.id,'people');
  assert.equal(primaryNavigation('/').some(item=>item.active),false);
  assert.equal(resolveRoute('/statistics/work'),'statistics');
  assert.equal(primaryNavigation('/statistics/work').find(item=>item.active)?.id,'statistics');
  assert.equal(resolveRoute('/unread'),'messages');
  assert.equal(resolveRoute('/admin/trash'),'admin');
});
