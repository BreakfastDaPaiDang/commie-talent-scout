import { useState } from 'react';
import { remainingVoteTime } from '../shared/knowledge';
import type { KnowledgeApi, KnowledgeIdentity, KnowledgeTagProposal } from '../shared/knowledge';
import { KnowledgeReviewBallot, KnowledgeReviewComparison, KnowledgeReviewHeader } from './KnowledgeReviewLayout';
import { TagChip } from './TagCatalog';
import './knowledge-tags.css';

type TagReviewProps = {
  api: KnowledgeApi;
  proposal: KnowledgeTagProposal;
  identity: KnowledgeIdentity;
  now: number;
  onChanged: () => void;
};

type TagApprovalReceipt = { approval_count: number; approved_by_me: number; adopted: boolean };

function TagDefinition({definition}: {definition: string}) {
  return <div className="kb-body">
    {definition ? <p className="kb-text kb-review-tag-definition">{definition}</p> :
      <p className="kb-muted">还没有标签解释</p>}
  </div>;
}

export function KnowledgeTagReviewDetail({api, proposal, identity, now, onChanged}: TagReviewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<TagApprovalReceipt | null>(null);
  const adopted = proposal.state === 'approved' || !!receipt?.adopted;
  const expired = proposal.state === 'expired' || Date.parse(proposal.expires_at) <= now;
  const approvedByMe = !!(proposal.approved_by_me || receipt?.approved_by_me);
  const canVote = identity.can_write && !adopted && !expired && !approvedByMe;
  const status = adopted ? '已入库' : expired ? '审核已过期' : '待认可';
  const deadline = adopted ? '' : expired ? '投票已截止' :
    remainingVoteTime(proposal.expires_at, Math.max(now, Date.parse(proposal.created_at)));
  const sharePath = '/knowledge?' + new URLSearchParams({tagProposal: proposal.id});

  async function approve() {
    setBusy(true);
    setError('');
    try {
      setReceipt(await api.write<TagApprovalReceipt>('/tag-proposals/approve', {id: proposal.id}));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return <article className="kb-review-detail">
    <KnowledgeReviewHeader title={proposal.name} status={status} adopted={adopted}
      author={proposal} identity={identity} sharePath={sharePath} />
    <div className="kb-review-notices">
      {error && <p role="alert" className="form-error">{error}</p>}
      {!proposal.pending && !proposal.current_name && <p role="status">未找到修改前的标签版本。</p>}
    </div>
    <section className="kb-diff kb-review-page">
      {!proposal.pending && !!proposal.current_name ? <KnowledgeReviewComparison
        current={<>
          <div className="kb-review-version-tags"><TagChip tag={{name: proposal.current_name}} /></div>
          <TagDefinition definition={proposal.current_definition} />
        </>}
        proposed={<>
          <div className="kb-review-version-tags"><TagChip tag={{name: proposal.name}} /></div>
          <TagDefinition definition={proposal.definition} />
        </>}
      /> : <div className="kb-review-reading"><TagDefinition definition={proposal.definition} /></div>}
      <KnowledgeReviewBallot
        approval={{...proposal, approval_count: Math.max(proposal.approval_count, receipt?.approval_count ?? 0)}}
        identity={identity} label="标签认可" approveLabel="认可此标签"
        deadline={deadline} busy={busy} showMyApproval={approvedByMe}
        onApprove={canVote ? approve : undefined} />
    </section>
  </article>;
}
