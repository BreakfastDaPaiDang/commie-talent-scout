import { z } from 'zod';
import { KnowledgeError, uid } from '../types.ts';
import type { KnowledgeTagProposal } from '../../../app/shared/knowledge.ts';
import type { ServiceContext } from './context.ts';
import { runCommand } from './command.ts';

const proposalFields = `p.id,p.category_id,p.name,p.definition,p.author_id,p.author_name,p.created_at,p.expires_at,p.state,
  w.withdrawn_at,CASE WHEN p.author_id=? AND w.resubmitted_id IS NULL AND w.proposal_id IS NOT NULL
    THEN json_object('name',w.draft_name,'definition',w.draft_definition,'version',w.version,'category_version',c.version) END AS draft_json,
  c.name AS current_name,c.definition AS current_definition,c.pending,
  (SELECT json_group_array(json_object('id',v.actor_id,'name',v.actor_name,'created_at',v.created_at) ORDER BY v.created_at,v.actor_id)
    FROM kw_tag_votes v WHERE v.proposal_id=p.id) AS approvers_json,
  EXISTS(SELECT 1 FROM kw_tag_votes v WHERE v.proposal_id=p.id AND (v.membership_id=? OR v.actor_id=?)) AS approved_by_me`;
const proposalSource = 'FROM kw_tag_proposals p JOIN kw_categories c ON c.id=p.category_id LEFT JOIN kw_tag_withdrawals w ON w.proposal_id=p.id';
type TagProposalRow = Omit<KnowledgeTagProposal, 'approvers' | 'approval_count'> & {approvers_json: string; withdrawn_at: string | null; draft_json: string | null};

function projectProposal({approvers_json, withdrawn_at, draft_json, ...row}: TagProposalRow, at: string): KnowledgeTagProposal {
  const approvers = JSON.parse(approvers_json) as KnowledgeTagProposal['approvers'];
  const state = withdrawn_at ? 'withdrawn' : row.state === 'pending' && row.expires_at <= at ? 'expired' : row.state;
  return {...row, state, ...(draft_json ? {draft:JSON.parse(draft_json)} : {}), approvers, approval_count: approvers.length};
}

export async function listTagProposals(context: ServiceContext) {
  const actor = context.actor;
  if (!context.showPendingTags || 'kind' in actor) return {proposals: []};
  const at = context.clock();
  const rows = await context.stmt(`SELECT ${proposalFields} ${proposalSource}
    WHERE (p.state='pending' AND p.expires_at>?) OR (p.author_id=? AND w.proposal_id IS NOT NULL AND w.resubmitted_id IS NULL)
    ORDER BY p.expires_at,p.id`,
    actor.id,actor.membership_id,actor.id,at,actor.id).all<TagProposalRow>();
  const items = rows.results.map(row => projectProposal(row, at));
  return {proposals: items.filter(p => p.state === 'pending'), drafts: items.filter(p => !!p.draft)};
}

export async function getTagProposal(context: ServiceContext, id: string): Promise<KnowledgeTagProposal> {
  const actor = context.actor;
  if (!context.showPendingTags || 'kind' in actor) throw new KnowledgeError(404,'NOT_FOUND','标签提议不存在或不可见');
  const at = context.clock();
  const row = await context.stmt(`SELECT ${proposalFields},p.base_version,c.version AS category_version,c.definition_version_id
    ${proposalSource} WHERE p.id=?`,actor.id,actor.membership_id,actor.id,id)
    .first<TagProposalRow & {base_version: number;category_version: number;definition_version_id: string | null}>();
  if (!row) throw new KnowledgeError(404,'NOT_FOUND','标签提议不存在或不可见');
  const {base_version, category_version, definition_version_id, ...fields} = row;
  const proposal = projectProposal(fields, at);
  if (proposal.draft || base_version >= category_version) return proposal;

  // A proposal's creation receipt keeps its original new-tag flag after approval updates the category.
  const original = proposal.author_id === 'system' ? {pending: 1} : await context.stmt(`SELECT
    json_extract(result_json,'$.pending') AS pending FROM kw_requests
    WHERE actor_id=? AND created_at=? AND json_extract(result_json,'$.proposal_id')=? LIMIT 1`,
    proposal.author_id,proposal.created_at,id).first<{pending: number | null}>();
  const base = original?.pending === 1 ? null : await context.stmt(`SELECT v.title,v.body FROM kw_versions v
    WHERE v.document_id=? AND v.rowid<=(SELECT rowid FROM kw_versions WHERE id=?)
    ORDER BY v.rowid DESC LIMIT 1 OFFSET ?`, 'category-'+proposal.category_id,definition_version_id,category_version-base_version)
    .first<{title: string;body: string}>();
  return {
    ...proposal,
    pending: original?.pending ?? Number(base_version === 1 && !base),
    current_name: base?.title ?? '',
    current_definition: base?.body ?? '',
  };
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
