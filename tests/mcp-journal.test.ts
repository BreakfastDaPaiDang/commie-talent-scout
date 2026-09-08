import test from 'node:test';
import assert from 'node:assert/strict';
import {redactText,registerJournalFields,safeParameters} from '../app/server/mcp-journal.ts';

test('request retention removes recognizable credentials from nested business prose and ignores extra fields',()=>{
  const secret='cts_'+'a'.repeat(64);
  registerJournalFields('journal_test',['body','evidence']);
  const result=safeParameters('journal_test',{body:`资料 ${secret} password=hidden Bearer abc123`,evidence:[{description:'链接 https://example.test/?token=abcdef',uploadToken:'not-stored'}],Authorization:'not-stored',surprise:'ignored'});
  assert.equal(result.state,'retained');
  assert.ok(!result.json.includes(secret));
  for(const value of ['hidden','abc123','abcdef','not-stored','ignored'])assert.ok(!result.json.includes(value));
  assert.ok(result.json.includes('资料'));
  assert.ok(!redactText('临时密码是 带 空格 的秘密\n下一条观察').includes('带 空格'));
  assert.ok(redactText('临时密码是 带 空格 的秘密\n下一条观察').includes('下一条观察'));
});
test('unknown tool parameters and oversize content are explicitly excluded',()=>{
  assert.equal(safeParameters('unknown',{password:'x',body:'private'}).json,'{}');
  registerJournalFields('large_test',['body']);
  const result=safeParameters('large_test',{body:'x'.repeat(33000)});
  assert.equal(result.state,'omitted_size');assert.ok(result.json.length<100);
  assert.ok(redactText('观察：参与周末活动').includes('参与周末活动'));
});
