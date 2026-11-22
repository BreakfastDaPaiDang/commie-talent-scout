import { z } from 'zod';
import type { KnowledgeCategory } from '../../../app/shared/knowledge.ts';
import { KnowledgeError, uid } from '../types.ts';
import { prepareCategoryChanges } from './categories.ts';
import { runCommand } from './command.ts';
import type { ServiceContext } from './context.ts';
import { workspaceSchemas } from './inputs.ts';
import { inheritDocumentScopes } from './document-scopes.ts';
import { getMergeRequest } from './review-queries.ts';

const tagId = z.object({id:z.uuid(), request_id:z.uuid()}).strict();
const editDraft = tagId.extend({
  expected_version:z.number().int().positive(),
  name:workspaceSchemas.categoryEdit.shape.name,
  definition:workspaceSchemas.categoryEdit.shape.definition,
  expected_category_version:z.number().int().positive().optional(),
  submit:z.boolean(),
});

function ownerRequired() {
  return new KnowledgeError(403,'AUTHOR_REQUIRED','只有提交者本人可以撤回或修改这份草稿');
}
function ballotClosed() {
  return new KnowledgeError(409,'BALLOT_CLOSED','本轮认可已结束或版本已变化，请刷新查看');
}

export async function withdrawReview(context: ServiceContext, input: unknown) {
  const a = workspaceSchemas.approve.parse(input);
  return runCommand(context,a,'review.withdraw',async at => {
    const review = await getMergeRequest(context,a.id,at);
    if (review.author_id !== context.actor.id) throw ownerRequired();
    if (review.state !== 'open' || review.voting_closed || review.approval_count >= 3 ||
        review.head_id !== a.head_id || review.current_head_id !== a.head_id || review.changes?.length !== 1) throw ballotClosed();
    const documentId = review.changes[0].document_id;
    const original = await context.stmt(`SELECT b.id FROM kw_review_sources s JOIN kw_branches b ON b.id=s.source_branch_id
      JOIN kw_items i ON i.branch_id=b.id AND i.document_id=s.document_id AND i.version_id=s.source_version_id
      WHERE s.merge_id=? AND b.visibility='private' AND b.owner_id=? AND b.state='open'`,
      a.id,context.actor.id).first<{id:string}>();
    const draftId = original?.id ?? uid();
    const statements = [context.stmt("UPDATE kw_merges SET state='closed',updated_at=?,version=version+1 WHERE id=?",at,a.id)];
    // A legacy public submission, deleted source, or independently edited draft
    // needs a separate editable copy of the actual submitted version.
    if (!original) {
      statements.push(
        context.stmt(`INSERT INTO kw_branches(id,name,owner_id,owner_name,visibility,head_id,base_head_id,created_at,updated_at)
          SELECT ?,?,?,?,'private',head_id,base_head_id,?,? FROM kw_branches WHERE id=?`,
          draftId,review.title.slice(0,55)+' · '+draftId.slice(0,8),context.actor.id,context.actor.name,at,at,review.branch_id),
        context.stmt('INSERT INTO kw_items SELECT ?,document_id,version_id,base_version_id FROM kw_items WHERE branch_id=?',draftId,review.branch_id),
      );
    }
    if (review.changes[0].deleted) {
      // Withdraw a removal into a readable draft of the retained text.
      const old = await context.stmt('SELECT version_id FROM kw_items WHERE branch_id=? AND document_id=?',
        review.branch_id,documentId).first<{version_id:string}>();
      if (!old) throw ballotClosed();
      const v = uid(), commit = uid();
      statements.push(
        context.stmt('INSERT INTO kw_versions SELECT ?,document_id,title,body,category_id,kind,source,0,?,?,? FROM kw_versions WHERE id=?',
          v,context.actor.id,context.actor.name,at,old.version_id),
        inheritDocumentScopes(context,v,old.version_id),
        context.stmt('INSERT INTO kw_version_tags SELECT ?,category_id,position FROM kw_version_tags WHERE version_id=?',v,old.version_id),
        context.stmt(`INSERT INTO kw_commits SELECT ?,id,head_id,NULL,'撤回移除申请',?,?,? FROM kw_branches WHERE id=?`,commit,context.actor.id,context.actor.name,at,draftId),
        context.stmt('INSERT INTO kw_changes VALUES(?,?,?,?)',commit,documentId,old.version_id,v),
        context.stmt('UPDATE kw_items SET version_id=? WHERE branch_id=? AND document_id=?',v,draftId,documentId),
        context.stmt('UPDATE kw_branches SET head_id=?,version=version+1,updated_at=? WHERE id=?',commit,at,draftId),
      );
    }
    return {statements,result:{id:a.id,head_id:a.head_id,branch_id:draftId,document_id:documentId}};
  });
}

export async function withdrawTag(context: ServiceContext, input: unknown) {
  if (!context.showPendingTags) throw new KnowledgeError(404,'NOT_FOUND','标签提议不存在或不可见');
  const a = tagId.parse(input);
  return runCommand(context,a,'tag.withdraw',async at => {
    const p = await context.stmt(`SELECT p.*, (SELECT count(*) FROM kw_tag_votes WHERE proposal_id=p.id) AS votes
      FROM kw_tag_proposals p WHERE p.id=?`,a.id).first<{author_id:string; state:string; expires_at:string; votes:number; category_id:string}>();
    if (!p) throw new KnowledgeError(404,'NOT_FOUND','标签提议不存在');
    if (p.author_id !== context.actor.id) throw ownerRequired();
    if (p.state !== 'pending' || p.expires_at <= at || p.votes >= 3) throw ballotClosed();
    return {statements:[
      context.stmt(`INSERT INTO kw_tag_withdrawals(proposal_id,withdrawn_at,draft_name,draft_definition)
        SELECT id,?,name,definition FROM kw_tag_proposals WHERE id=?`,at,a.id),
      // This is the existing terminal, unadopted ballot state. The withdrawal
      // record distinguishes it from a timeout, including after resubmission.
      context.stmt("UPDATE kw_tag_proposals SET state='expired' WHERE id=?",a.id),
      context.stmt('UPDATE kw_categories SET independent=0 WHERE id=? AND pending=1',p.category_id),
    ],result:{id:a.id,version:1}};
  });
}

export async function saveTagDraft(context: ServiceContext, input: unknown) {
  if (!context.showPendingTags) throw new KnowledgeError(404,'NOT_FOUND','标签草稿不存在');
  const a = editDraft.parse(input);
  return runCommand(context,a,'tag.draft.save',async at => {
    const draft = await context.stmt(`SELECT w.version,w.resubmitted_id,p.author_id,p.category_id,p.base_version
      FROM kw_tag_withdrawals w JOIN kw_tag_proposals p ON p.id=w.proposal_id WHERE w.proposal_id=?`,a.id)
      .first<{version:number;resubmitted_id:string|null;author_id:string;category_id:string;base_version:number}>();
    if (!draft || draft.author_id !== context.actor.id) throw ownerRequired();
    if (draft.resubmitted_id || draft.version !== a.expected_version) throw new KnowledgeError(409,'CONFLICT','草稿已变化，请刷新后重试');
    const category = await context.stmt('SELECT * FROM kw_categories WHERE id=?',draft.category_id).first<KnowledgeCategory>();
    if (!category) throw new KnowledgeError(404,'NOT_FOUND','标签已不存在');
    const ballot = a.submit ? await prepareCategoryChanges(context,{
      branch_id:'main',id:category.id,expected_version:a.expected_category_version ?? draft.base_version,name:a.name,definition:a.definition,
    },at,category) : null;
    const proposalId = ballot?.result.proposal_id ?? null;
    return {statements:[...(ballot?.statements ?? []),
      context.stmt('UPDATE kw_tag_withdrawals SET draft_name=?,draft_definition=?,version=version+1,resubmitted_id=? WHERE proposal_id=?',
        a.name,a.definition,proposalId,a.id),
    ],result:{id:a.id,version:draft.version+1,proposal_id:proposalId}};
  });
}
