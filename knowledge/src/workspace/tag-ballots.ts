import { z } from 'zod';
import { KnowledgeError, uid } from '../types.ts';
import type { KnowledgeTagProposal } from '../../../app/shared/knowledge.ts';
import type { ServiceContext } from './context.ts';
import { runCommand } from './command.ts';

export async function listTagProposals(context: ServiceContext) {
  if (!context.showPendingTags) return {proposals: []};
  const actor = context.actor;
  const result = await context.stmt(`SELECT p.id,p.category_id,p.name,p.definition,p.author_name,p.expires_at,
    c.name current_name,c.definition current_definition,c.pending,
    (SELECT count(*) FROM kw_tag_votes v WHERE v.proposal_id=p.id) approval_count,
    EXISTS(SELECT 1 FROM kw_tag_votes v WHERE v.proposal_id=p.id AND (v.membership_id=? OR v.actor_id=?)) approved_by_me
    FROM kw_tag_proposals p JOIN kw_categories c ON c.id=p.category_id
    WHERE p.state='pending' AND p.expires_at>? ORDER BY p.expires_at,p.id`,
    'membership_id' in actor ? actor.membership_id : null,actor.id,context.clock()).all<KnowledgeTagProposal>();
  return {proposals: result.results};
}

const vote = z.object({id: z.uuid(),request_id: z.uuid()}).strict();
export async function approveTag(context: ServiceContext, input: unknown) {
  if (!context.showPendingTags) throw new KnowledgeError(403,'TAG_REVIEW_UNAVAILABLE','请在知识库待办中审阅这份标签提议');
  const a = vote.parse(input);
  return runCommand(context,a,'tag.approve',async at => {
    const actor = context.actor;
    if ('kind' in actor || !actor.membership_id) throw new KnowledgeError(403,'FORMAL_MEMBER_REQUIRED','仅当前绑定的正式社员可认可标签');
    const p = await context.stmt(`SELECT p.*,c.version,c.pending FROM kw_tag_proposals p
      JOIN kw_categories c ON c.id=p.category_id WHERE p.id=?`,a.id)
      .first<{category_id:string;name:string;definition:string;version:number;pending:number;base_version:number;state:string;expires_at:string;author_id:string;author_name:string}>();
    if (!p || p.state!=='pending' || p.expires_at<=at || p.version!==p.base_version) throw new KnowledgeError(409,'TAG_VOTE_CLOSED','本轮标签认可已结束，请刷新查看');
    const votes = await context.stmt('SELECT membership_id,actor_id FROM kw_tag_votes WHERE proposal_id=?',a.id).all<{membership_id:string;actor_id:string}>();
    const alreadyVoted=votes.results.some(v=>v.membership_id===actor.membership_id || v.actor_id===actor.id);
    const count=votes.results.length+(alreadyVoted?0:1);
    const statements = [context.stmt('INSERT OR IGNORE INTO kw_tag_votes VALUES(?,?,?,?,?)',a.id,actor.membership_id,actor.id,actor.name,at)];
    if (count>=3) {
      const duplicate = await context.stmt('SELECT id FROM kw_categories WHERE name=? AND id<>?',p.name,p.category_id).first();
      if (duplicate) throw new KnowledgeError(409,'TAG_NAME_TAKEN','这个名称已被使用，请重新提出修改');
      const versionId=uid(), documentId='category-'+p.category_id;
      statements.push(
        context.stmt('INSERT OR IGNORE INTO kw_documents VALUES(?,?,?,?)',documentId,p.author_id,p.author_name,at),
        context.stmt('INSERT INTO kw_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)',versionId,documentId,p.name,p.definition,p.category_id,'分类解释','',0,p.author_id,p.author_name,at),
        context.stmt('UPDATE kw_categories SET name=?,definition=?,definition_version_id=?,version=version+1,updated_at=?,pending=0,independent=1 WHERE id=?',p.name,p.definition,versionId,at,p.category_id),
        context.stmt("UPDATE kw_tag_proposals SET state='approved' WHERE id=?",a.id)
      );
    }
    return {statements,result:{id:a.id,approved_by_me:1,approval_count:count,adopted:count>=3}};
  });
}
