import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import worker from '../app/server/index.ts';
import { Archives } from '../app/server/archives.ts';
import { Observations } from '../app/server/observations.ts';
import { PersonnelRecognition } from '../app/server/personnel-recognition.ts';
import { WorkTasks } from '../app/server/work-tasks.ts';
import { digest } from '../app/server/types.ts';
import { fixture } from './d1-fixture.mjs';
import { formalActor, legacyReferral } from './personnel-fixture.mjs';

async function reader(f, actor = f.actor) {
  const token = uuid();
  f.sqlite.prepare('UPDATE credentials SET hash=? WHERE id=?').run(await digest(token), actor.credential_id);
  const authorization = 'Bearer ' + token;
  const headers = {
    Host: new URL(f.env.APP_ORIGIN).host,
    Authorization: authorization,
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json'
  };
  let id = 0;
  const pending = [], ctx = { waitUntil(p) { pending.push(p); } };
  async function rpc(method, params) {
    const response = await worker.fetch(new Request(f.env.APP_ORIGIN + '/mcp', {
      method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
    }), f.env, ctx);
    const body = await response.text();
    await Promise.all(pending.splice(0));
    assert.equal(response.status, 200, body);
    const data = body.startsWith('{') ? body : body.split('\n').find(line => line.startsWith('data:')).slice(5);
    const parsed = JSON.parse(data);
    assert.equal(parsed.error, undefined, data);
    return parsed.result;
  }
  const initialized = await rpc('initialize', {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'personnel-task-evidence', version: '1' }
  });
  headers['MCP-Protocol-Version'] = initialized.protocolVersion;
  return {
    rpc,
    async detail(taskId) {
      const result = await rpc('tools/call', { name: 'get_work_task', arguments: { id: taskId } });
      assert.ok(!result.isError, JSON.stringify(result));
      return result.structuredContent;
    },
    async evidence(url) {
      const link = new URL(url), params = link.searchParams;
      const response = await worker.fetch(new Request(`${link.origin}/api/observations/${params.get('observation')}?version=${params.get('version')}`, {
        headers: { Authorization: authorization }
      }), f.env, ctx);
      assert.equal(response.status, 200);
      return (await response.json()).observation;
    }
  };
}

function recognize(f, actor, observation, roundNumber = 1) {
  return new PersonnelRecognition(f.env, actor, 'web').recognize({
    archive_id: observation.archive_id, round_number: roundNumber, observation_id: observation.id,
    content_version: observation.content_version, request_id: uuid()
  });
}

test('MCP audit detail keeps the triggering round and its observation versions through later changes', async t => {
  const f = fixture();
  t.after(f.close);
  const archives = new Archives(f.env, f.actor, 'web'), observations = new Observations(f.env, f.actor, 'web');
  const tasks = new WorkTasks(f.env, f.actor, 'web');
  const archive = await archives.create({ type: 'person', name: '虚构人物', request_id: uuid() });
  const createObservation = body => observations.create({ archive_id: archive.id, body, request_id: uuid() });
  const firstEvidence = await createObservation('第一份认可的原始依据');
  const deletedBefore = await createObservation('审核触发前删除的依据');
  const secondEvidence = await createObservation('审核触发后删除的依据');
  const thirdEvidence = await createObservation('触发审核的依据');
  const [priorWithdrawal, priorDeletion, first, second, third] = [
    '提前撤回者', '依据提前删除者', '认可人甲', '认可人乙', '认可人丙'
  ].map(name => formalActor(f, { name }));

  const inactive = await recognize(f, priorWithdrawal, firstEvidence);
  await new PersonnelRecognition(f.env, priorWithdrawal, 'web').withdraw({ id: inactive.id, request_id: uuid() });
  await recognize(f, priorDeletion, deletedBefore);
  const deleted = await observations.setDeleted({ id: deletedBefore.id, expected_version: deletedBefore.version, request_id: uuid() }, true);
  const vote1 = await recognize(f, first, firstEvidence);
  const revised = await observations.update({
    id: firstEvidence.id, expected_version: firstEvidence.version, body: '第一份依据的新版本',
    occurred_at: null, request_id: uuid()
  });
  const vote2 = await recognize(f, second, secondEvidence);
  const vote3 = await recognize(f, third, thirdEvidence);
  assert.equal(vote3.count, 3);

  const author = await reader(f);
  const initial = (await author.detail(vote3.task_id)).personnel_recognition;
  assert.equal(initial.round_number, 1);
  assert.equal(initial.legacy, false);
  assert.deepEqual(initial.votes.map(vote => [vote.id, vote.member_archive_id, vote.name, vote.triggered]), [
    [vote1.id, first.archiveId, first.name, false],
    [vote2.id, second.archiveId, second.name, false],
    [vote3.id, third.archiveId, third.name, true]
  ]);
  assert.deepEqual(initial.votes.map(vote => vote.evidence.observation_id), [firstEvidence.id, secondEvidence.id, thirdEvidence.id]);
  const pinned = initial.votes[0].evidence;
  assert.equal(pinned.content_version, firstEvidence.content_version);
  assert.equal(new URL(pinned.url).searchParams.get('archive'), archive.id);
  assert.equal((await author.evidence(pinned.url)).body, '第一份认可的原始依据');

  await new PersonnelRecognition(f.env, first, 'web').withdraw({ id: vote1.id, request_id: uuid() });
  await observations.setDeleted({ id: secondEvidence.id, expected_version: secondEvidence.version, request_id: uuid() }, true);
  await observations.setDeleted({ id: deletedBefore.id, expected_version: deleted.version, request_id: uuid() }, false);
  const outsideReader = await reader(f, third);
  const changed = (await outsideReader.detail(vote3.task_id)).personnel_recognition;
  assert.deepEqual(changed.votes.map(vote => vote.id), [vote1.id, vote2.id, vote3.id]);
  assert.ok(changed.votes[0].withdrawn_at);
  assert.equal(changed.votes[1].evidence_deleted, true);
  assert.equal(changed.votes[1].evidence, null);
  assert.ok(!JSON.stringify(changed).includes(secondEvidence.id));
  const authorized = (await author.detail(vote3.task_id)).personnel_recognition.votes[1];
  assert.equal(authorized.evidence_deleted, true);
  assert.equal((await author.evidence(authorized.evidence.url)).body, '审核触发后删除的依据');

  const claim = await tasks.claim({ id: vote3.task_id, expected_version: 1, request_id: uuid() });
  await tasks.cancel({ id: vote3.task_id, expected_version: claim.version, reason: '结束第一轮', request_id: uuid() });
  const round2 = [];
  for (const actor of [first, second, third]) round2.push(await recognize(f, actor, revised, 2));
  const current = (await outsideReader.detail(round2[2].task_id)).personnel_recognition;
  assert.equal(current.round_number, 2);
  assert.notEqual(current.round_id, initial.round_id);
  assert.deepEqual(current.votes.map(vote => vote.id), round2.map(vote => vote.id));
  assert.equal(current.votes[0].evidence.content_version, revised.content_version);
  const historical = await outsideReader.detail(vote3.task_id);
  assert.equal(historical.task.status, 'cancelled');
  assert.deepEqual(historical.personnel_recognition, changed);
});

test('MCP audit detail reports all recognitions that were effective after evidence was restored before the trigger', async t => {
  const f = fixture();
  t.after(f.close);
  const archives = new Archives(f.env, f.actor, 'web'), observations = new Observations(f.env, f.actor, 'web');
  const archive = await archives.create({ type: 'person', name: '虚构人物', request_id: uuid() });
  const first = await observations.create({ archive_id: archive.id, body: '可恢复的观察', request_id: uuid() });
  const other = await observations.create({ archive_id: archive.id, body: '其他依据', request_id: uuid() });
  const votes = [await recognize(f, formalActor(f), first)];
  const deleted = await observations.setDeleted({ id: first.id, expected_version: first.version, request_id: uuid() }, true);
  for (let i = 0; i < 2; i++) votes.push(await recognize(f, formalActor(f), other));
  await observations.setDeleted({ id: first.id, expected_version: deleted.version, request_id: uuid() }, false);
  const last = await recognize(f, formalActor(f), other);
  votes.push(last);
  assert.equal(last.count, 4);
  const detail = await (await reader(f)).detail(last.task_id);
  assert.deepEqual(detail.personnel_recognition.votes.map(vote => vote.id), votes.map(vote => vote.id));
  assert.deepEqual(detail.personnel_recognition.votes.filter(vote => vote.triggered).map(vote => vote.id), [last.id]);
});

test('MCP task detail supports legacy audits and keeps the ordinary task contract', async t => {
  const f = fixture();
  t.after(f.close);
  const archive = await new Archives(f.env, f.actor, 'web').create({ type: 'person', name: '旧审核样本', request_id: uuid() });
  const { task_id } = await legacyReferral(f, archive.id);
  const mcp = await reader(f);
  assert.equal((await mcp.detail(task_id)).personnel_recognition, undefined);
  const roundId = uuid();
  f.sqlite.prepare("INSERT INTO personnel_recognition_rounds(id,archive_id,number,state,task_id,legacy,created_at) VALUES(?,?,1,'reviewing',?,1,?)")
    .run(roundId, archive.id, task_id, new Date().toISOString());
  assert.deepEqual((await mcp.detail(task_id)).personnel_recognition, {
    round_id: roundId, round_number: 1, legacy: true, votes: []
  });

  const tasks = new WorkTasks(f.env, f.actor, 'web');
  const ordinary = await tasks.create({
    archive_id: archive.id, title: '普通任务', purpose: '测试', delivery: '记录',
    deadline_at: '2099-01-01T00:00:00.000Z', request_id: uuid()
  });
  const detail = await mcp.detail(ordinary.id);
  assert.equal(detail.task.id, ordinary.id);
  assert.deepEqual(detail, await tasks.detail(ordinary.id));
});

test('ordinary MCP account can discover and execute evidence-backed historical member registration',async t=>{
  const f=fixture();t.after(f.close);
  const client=await reader(f);
  const who=await client.rpc('tools/call',{name:'whoami',arguments:{}});
  assert.equal(who.structuredContent.member.role,'member');
  assert.ok(who.structuredContent.capabilities.includes('backfill_member_archive'));
  const result=await client.rpc('tools/call',{name:'backfill_member_archive',arguments:{
    name:'虚构旧社员',qq:'150123456',basis:'已和本人核对原入社记录',request_id:uuid(),
  }});
  assert.ok(!result.isError,JSON.stringify(result));
  const row=f.sqlite.prepare('SELECT archive_id,actor_id,source FROM archive_events WHERE observation_id=?').get(result.structuredContent.observation_id);
  assert.equal(row.archive_id,result.structuredContent.id);
  assert.equal(row.actor_id,f.actor.id);assert.equal(row.source,'mcp');
});
