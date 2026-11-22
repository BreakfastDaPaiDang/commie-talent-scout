import { useState } from 'react';
import { remainingVoteTime } from '../shared/knowledge';
import type { KnowledgeApi, KnowledgeIdentity, KnowledgeTagProposal } from '../shared/knowledge';
import { KnowledgeReviewBallot, KnowledgeReviewComparison, KnowledgeReviewHeader } from './KnowledgeReviewLayout';
import { TagChip, TagDefinitionFields } from './TagCatalog';
import './knowledge-tags.css';

type TagReviewProps = {
  api: KnowledgeApi;
  proposal: KnowledgeTagProposal;
  identity: KnowledgeIdentity;
  now: number;
  onChanged: () => void;
  onSubmitted: (id: string) => void;
};

type TagApprovalReceipt = { approval_count: number; approved_by_me: number; adopted: boolean };

function TagDefinition({definition}: {definition: string}) {
  return <div className="kb-body">
    {definition ? <p className="kb-text kb-review-tag-definition">{definition}</p> :
      <p className="kb-muted">还没有标签解释</p>}
  </div>;
}

export function KnowledgeTagReviewDetail({api, proposal, identity, now, onChanged, onSubmitted}: TagReviewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<TagApprovalReceipt | null>(null);
  const adopted = proposal.state === 'approved' || !!receipt?.adopted;
  const expired = proposal.state === 'expired' || Date.parse(proposal.expires_at) <= now;
  const approvedByMe = !!(proposal.approved_by_me || receipt?.approved_by_me);
  const withdrawn = proposal.state === 'withdrawn';
  const canVote = identity.can_write && !withdrawn && !adopted && !expired && !approvedByMe;
  const status = withdrawn ? '已撤回' : adopted ? '已入库' : expired ? '审核已过期' : '待认可';
  const deadline = adopted || withdrawn ? '' : expired ? '投票已截止' :
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

  async function withdraw() {
    setBusy(true);
    setError('');
    try {
      await api.write('/tag-proposals/withdraw',{id:proposal.id});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      onChanged();
      setBusy(false);
    }
  }

  if (proposal.draft && identity.id === proposal.author_id) return <TagDraftEditor
    key={proposal.id + ':' + proposal.draft.version} api={api} proposalId={proposal.id} draft={proposal.draft}
    current={proposal.pending ? undefined : {name:proposal.current_name,definition:proposal.current_definition}}
    onChanged={onChanged} onSubmitted={onSubmitted} />;
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
        onApprove={canVote ? approve : undefined}>
        {identity.can_write && identity.id === proposal.author_id && !adopted && !expired && !withdrawn &&
          <button className="button quiet" disabled={busy} onClick={withdraw}>撤回到草稿</button>}
      </KnowledgeReviewBallot>
    </section>
  </article>;
}

function TagDraftEditor({api, proposalId, draft, current, onChanged, onSubmitted}: {
  api: KnowledgeApi; proposalId:string; draft:NonNullable<KnowledgeTagProposal['draft']>;
  current?:{name:string;definition:string}; onChanged:()=>void; onSubmitted:(id:string)=>void;
}) {
  const [name,setName] = useState(draft.name);
  const [definition,setDefinition] = useState(draft.definition);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function save(submit:boolean) {
    setBusy(true);
    setError('');
    try {
      const result = await api.write<{proposal_id:string|null}>('/tag-drafts/save',{
        id:proposalId, expected_version:draft.version, expected_category_version:draft.category_version, name, definition, submit,
      });
      if (result.proposal_id) onSubmitted(result.proposal_id);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <article className="kb-review-detail">
    <header className="kb-review-title"><h1>{draft.name}</h1><span className="kb-review-state">我的草稿</span></header>
    {current && <p className="kb-review-reason"><span>已入库标签</span>{current.name} · {current.definition}</p>}
    <form className="manage-form" onSubmit={e=>{e.preventDefault();void save(true);}}>
      <TagDefinitionFields name={name} onName={setName} description={definition} onDescription={setDefinition}
        busy={busy} nameLabel="标签名称" descriptionLabel="标签解释" descriptionRequired={false} descriptionLimit={4000} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="kb-review-buttons">
        <button type="button" className="button quiet" disabled={busy || !name.trim() || name===draft.name && definition===draft.definition}
          onClick={()=>void save(false)}>保存草稿</button>
        <button type="submit" className="button primary" disabled={busy || !name.trim()}>重新提交认可</button>
      </div>
    </form>
  </article>;
}
