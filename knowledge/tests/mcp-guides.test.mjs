import test from 'node:test';
import assert from 'node:assert/strict';
import {connectMcp, connectedFixture} from './connected-fixture.mjs';
import {request} from './fixture.mjs';
import {KnowledgeWorkspace} from '../src/workspace.ts';

async function invoke(rpc, name, args = {}) {
  const result = await rpc('tools/call', {name, arguments: args});
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent;
}

test('both MCP entry points discover the same knowledge workflow and the main site advertises review guidance', async (t) => {
  const f = await connectedFixture();
  t.after(f.close);
  const main = await connectMcp(f);
  const direct = await connectMcp(f, true);
  const {rules} = await invoke(main, 'knowledge_workspace_guide');
  assert.deepEqual((await invoke(direct, 'knowledge_workspace_guide')).rules, rules);
  assert.deepEqual((await invoke(main, 'get_usage_guide', {topic: 'knowledge'})).rules, rules);
  for (const rpc of [main, direct]) {
    assert.ok(rpc.init.instructions.includes(rules[0]));
    assert.match(rpc.init.instructions, /首次开展人事业务.*丢失上下文.*knowledge_workspace_guide.*knowledge_documents.*next_offset.*branch\.head_id.*tag_revision.*KNOWLEDGE_SNAPSHOT_CHANGED/);
  }
  assert.equal((await invoke(main, 'whoami')).member.id, f.p.actor.id);
  const {identity} = await invoke(direct, 'knowledge_branches');
  assert.equal(identity.id, f.p.actor.id);
  assert.equal(identity.can_write, true);
  assert.match(direct.init.instructions, /连接主站.*personnel_review/);
  assert.match(main.init.instructions, /get_usage_guide\(topic="personnel_review"\)/);

  const knowledgeGuide = rules.join('\n');
  assert.match(knowledgeGuide, /正文全文.*version_id.*reference_url/);
  assert.match(knowledgeGuide, /跨文档业务矛盾.*不适配.*新经验/);
  assert.match(knowledgeGuide, /明确获准.*knowledge_create_issue.*引用.*body/);
  assert.match(knowledgeGuide, /获准保存私人草稿.*visibility="private".*knowledge_save_document.*获准提审.*knowledge_submit_review.*knowledge_agree.*明确授权/);
  const review = (await invoke(main, 'get_usage_guide', {topic: 'personnel_review'})).rules.join('\n');
  assert.match(review, /会前.*get_archive.*list_observations.*get_work_task/);
  assert.match(review, /问题与追问方式.*为什么问.*什么依据/);
  assert.match(review, /会中.*可核实事实.*自述.*判断.*待核实/);
  assert.match(review, /会后.*观察草稿.*结论已有依据.*仍待核实/);
  assert.match(review, /明确授权.*只确认发布观察就只发观察.*发布观察并认可他.*create_observation.*recognize_person.*月度额度/);
  assert.match(review, /负责人.*complete_work_task.*audit_passed/);
});

test('the documented pagination and freshness check expose whole effective versions on both MCP entry points', async (t) => {
  const f = await connectedFixture();
  t.after(f.close);
  const clients = [await connectMcp(f), await connectMcp(f, true)];
  const voters = f.k.actors.slice(0, 3).map(actor => new KnowledgeWorkspace(f.k.db, actor));
  const [author] = voters;
  async function stage(title, body, document_id) {
    const branch = await author.createBranch({name: title, visibility: 'private', request_id: request()});
    const doc = await author.save({branch_id: branch.id, expected_version: branch.version, document_id, title, body, message: '审核材料', request_id: request()});
    const review = await author.submitReview({branch_id: branch.id, expected_version: doc.version, document_id: doc.id, version_id: doc.version_id, request_id: request()});
    return {doc, review, body};
  }
  async function adopt({review}) {
    for (const voter of voters) await voter.approve({id: review.id, head_id: review.head_id, request_id: request()});
  }
  const a = await stage('了解协作意愿', '先问现在愿意参与哪些工作。\n再核实对方能接受的时间安排。');
  await adopt(a);
  const b = await stage('了解实际经验', '先问做过哪些事情。\n再追问其中一次的具体分工和结果。');
  await adopt(b);
  const pending = await stage('了解近期协作意愿', '先核实是否存在时间上的前提。', a.doc.id);

  const read = (rpc, offset = 0) => invoke(rpc, 'knowledge_documents', {branch_id: 'main', offset, limit: 1});
  const [start] = await Promise.all(clients.map(async rpc => {
    const first = await read(rpc);
    assert.equal(first.next_offset, 1);
    const second = await read(rpc, first.next_offset);
    assert.equal(second.next_offset, null);
    assert.equal(second.branch.head_id, first.branch.head_id);
    assert.equal(second.tag_revision, first.tag_revision);
    const documents = new Map([...first.documents, ...second.documents].map(doc => [doc.document_id, doc]));
    assert.equal(documents.size, 2);
    for (const {doc, body} of [a, b]) {
      assert.equal(documents.get(doc.id).body, body);
      assert.equal(documents.get(doc.id).version_id, doc.version_id);
      assert.ok(documents.get(doc.id).reference_url);
    }
    return first;
  }));

  const tag = await author.editCategory({name: '可用时间', request_id: request()});
  for (const voter of voters) await voter.approveTag({id: tag.proposal_id, request_id: request()});
  for (const rpc of clients) {
    const refreshed = await read(rpc);
    assert.equal(refreshed.branch.head_id, start.branch.head_id);
    assert.equal(refreshed.tag_revision, start.tag_revision + 1);
  }
  await adopt(pending);
  for (const rpc of clients) {
    const refreshed = await read(rpc);
    assert.notEqual(refreshed.branch.head_id, start.branch.head_id);
    assert.equal(refreshed.tag_revision, start.tag_revision + 1);
    assert.equal((await invoke(rpc, 'knowledge_document', {branch_id: 'main', id: a.doc.id})).document.version_id, pending.doc.version_id);
  }
});
