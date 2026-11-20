import test from 'node:test';
import assert from 'node:assert/strict';
import {connectedFixture, connectMcp} from './connected-fixture.mjs';
import {request} from './fixture.mjs';
import {formalActor} from '../../tests/personnel-fixture.mjs';
import {Archives} from '../../app/server/archives.ts';
import {Observations} from '../../app/server/observations.ts';
import {PersonnelRecognition} from '../../app/server/personnel-recognition.ts';
import {KnowledgeWorkspace} from '../src/workspace.ts';

test('a fresh personnel MCP client can prepare a specific review from adopted knowledge and the observations which started the task', async t => {
  const f = await connectedFixture();
  t.after(() => f.close());
  const members = f.k.actors.slice(0, 3).map(actor => new KnowledgeWorkspace(f.k.db, actor));
  const method = '请作者指出亲自完成的一处修改，并说明修改前后的取舍。';
  const author = members[0];
  const branch = await author.createBranch({name:'虚构的作品审核方法', request_id:request()});
  const doc = await author.save({branch_id:branch.id, expected_version:branch.version,
    title:'从实际作品展开追问', body:method, message:'本地演练', request_id:request()});
  const review = await author.submitReview({branch_id:branch.id, expected_version:doc.version,
    document_id:doc.id, version_id:doc.version_id, request_id:request()});
  for (const member of members) await member.approve({id:review.id, head_id:review.head_id, request_id:request()});

  const archives = new Archives(f.p.env, f.p.actor, 'web');
  const archive = await archives.create({name:'虚构试稿者', type:'person', request_id:request()});
  const observations = new Observations(f.p.env, f.p.actor, 'web');
  const facts = ['按约定交了试稿。', '接受校对建议后补了出处。', '愿意再试一次，时间尚待商量。'];
  let taskId, firstObservation;
  for (const fact of facts) {
    const note = await observations.create({archive_id:archive.id, body:fact, request_id:request()});
    firstObservation ??= note.id;
    const voter = new PersonnelRecognition(f.p.env, formalActor(f.p), 'web');
    const vote = await voter.recognize({archive_id:archive.id, round_number:1, observation_id:note.id,
      content_version:1, request_id:request()});
    taskId = vote.task_id;
  }
  await observations.update({id:firstObservation, expected_version:1, body:'后来核对了交稿日期。',
    occurred_at:null, attachment_ids:[], request_id:request()});

  const rpc = await connectMcp(f);
  const read = async (name, args = {}) => {
    const result = await rpc('tools/call', {name, arguments:args});
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent;
  };
  await read('knowledge_workspace_guide');
  const library = await read('knowledge_documents', {scope:'main'});
  assert.equal(library.next_offset, null);
  assert.deepEqual(library.documents.map(d => [d.document_id, d.body]), [[doc.id, method]]);
  await read('get_usage_guide', {topic:'personnel_review'});
  const task = await read('get_work_task', {id:taskId});
  const person = await read('get_archive', {id:task.task.archive_id});
  assert.equal(person.archive.name, '虚构试稿者');
  const evidence = [];
  for (const {evidence: ref} of task.personnel_recognition.votes) {
    assert.equal(ref.archive_id, person.archive.id);
    const {versions} = await read('list_observation_versions', {id:ref.observation_id});
    evidence.push(versions.find(v => v.version === ref.content_version).body);
  }
  assert.deepEqual(evidence, facts);
  assert.equal(task.task.owner_id, null);
  assert.equal(f.p.sqlite.prepare('SELECT count(*) n FROM personnel_recognitions').get().n, 3);
});
