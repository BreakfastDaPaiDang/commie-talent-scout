import { useEffect, useState } from 'react';
import type { KnowledgeApi, KnowledgeBranch, KnowledgeDiff, KnowledgeIdentity, KnowledgeMerge, KnowledgeVersion } from '../shared/knowledge';
import { remainingVoteTime } from '../shared/knowledge';
import { KnowledgeDocumentBody } from './KnowledgeComments';
import { KnowledgeReviewBallot, KnowledgeReviewComparison, KnowledgeReviewHeader } from './KnowledgeReviewLayout';
import { Modal, ModalActions } from './Modal';
import { TagChip } from './TagCatalog';

export function votingClosed(merge: KnowledgeMerge, now: number) {
  return !!merge.voting_closed || (!!merge.expires_at && Date.parse(merge.expires_at) <= now);
}

export function reviewDeadline(merge: KnowledgeMerge, now: number) {
  if (!merge.expires_at || merge.state !== 'open') return '';
  if (votingClosed(merge, now)) return '投票已截止';
  // A newly submitted version may arrive between two countdown ticks.
  return remainingVoteTime(merge.expires_at, Math.max(now, Date.parse(merge.created_at)));
}

export function reviewStatus(merge: KnowledgeMerge, now: number) {
  if (merge.state === 'merged') return '已入库';
  if (merge.state === 'closed') return '审核已关闭';
  if (merge.expired || (merge.approval_count < 3 && votingClosed(merge, now))) return '审核已过期';
  if (merge.head_id !== merge.current_head_id) return '版本已变更';
  if ((merge.changes?.length ?? 0) > 1) return '需逐篇提交';
  if (merge.approval_count >= 3) return '已达标 · 待处理';
  return '待认可';
}

type ReviewDetailProps = {
  api: KnowledgeApi;
  merge: KnowledgeMerge;
  identity: KnowledgeIdentity;
  onIssue: (id: string) => void;
  revision: number;
  now: number;
  requestedHead: string | null;
  onChanged: () => void;
  onCollaborate: () => void;
  onOpenCurrent: () => void;
  onReadDocument: (id: string) => void;
  onResubmitted: (id: string, head: string, branch: string) => void;
};

export function KnowledgeReviewDetail({
  api, merge, identity, onIssue, revision, now, requestedHead, onChanged, onCollaborate, onOpenCurrent, onReadDocument, onResubmitted,
}: ReviewDetailProps) {
  const [diff, setDiff] = useState<{branch: KnowledgeBranch; changes: KnowledgeDiff[]} | null>(null);
  const [readError, setReadError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [busy, setBusy] = useState(false);
  const [vote, setVote] = useState<{approval_count: number; merged: boolean; pending?: string | null} | null>(null);
  const outdated = !!requestedHead && requestedHead !== merge.head_id;
  const current = merge.head_id === merge.current_head_id;
  const status = vote ? {
    ...merge,
    state: vote.merged ? 'merged' as const : merge.state,
    approval_count: Math.max(vote.approval_count, merge.approval_count),
    approved_by_me: 1,
  } : merge;

  useEffect(() => {
    if (outdated || !current) return;
    let active = true;
    setReadError('');
    api.read<{branch: KnowledgeBranch; changes: KnowledgeDiff[]}>('/diff?branch_id=' + encodeURIComponent(merge.branch_id)).then(result => {
      if (!active) return;
      if (result.branch.head_id !== merge.head_id) {
        setReadError('审核版本已更新，请重新读取。');
      } else {
        setDiff(result);
      }
    }).catch(error => {
      if (active) setReadError(error.message);
    });
    return () => { active = false; };
  }, [api, merge.branch_id, merge.head_id, current, outdated, revision]);

  async function approve() {
    setBusy(true);
    setWriteError('');
    try {
      const result = await api.write('/merges/approve', {id: merge.id, head_id: merge.head_id});
      setVote(result);
    } catch (error) {
      setWriteError((error as Error).message);
    } finally {
      onChanged();
      setBusy(false);
    }
  }

  async function resubmit(change: KnowledgeDiff) {
    if (!diff) return;
    setBusy(true);
    setWriteError('');
    try {
      const result = await api.write('/reviews', {
        branch_id: diff.branch.id,
        expected_version: diff.branch.version,
        document_id: change.document_id,
        version_id: change.proposed.id,
        reason: merge.reason,
      });
      onResubmitted(result.id, result.head_id, result.branch_id);
    } catch (error) {
      setWriteError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const changes = current && !outdated && !readError ? diff?.changes : undefined;
  const bundle = (changes?.length ?? merge.changes?.length ?? 0) > 1;
  const canVote = changes?.length === 1 && status.state === 'open' && !status.expired && !votingClosed(status, now) && !status.approved_by_me;
  const canResubmit = bundle && diff?.branch.state === 'open' && diff.branch.owner_id === identity.id;
  const sharePath = !outdated && current ? '/knowledge?' + new URLSearchParams({review: merge.id, head: merge.head_id}) : undefined;
  const ballot = <KnowledgeReviewBallot approval={status} identity={identity} deadline={reviewDeadline(status, now)}
    busy={busy} onApprove={canVote ? approve : undefined}
    showMyApproval={!canVote && !!status.approved_by_me && status.state === 'open'}>
    {status.state === 'merged' && changes?.length === 1 && !changes[0].proposed.deleted &&
      <button className="button quiet" onClick={() => onReadDocument(changes[0].document_id)}>查看已入库文档</button>}
  </KnowledgeReviewBallot>;

  return <article className="kb-review-detail">
    <KnowledgeReviewHeader title={merge.title} status={outdated ? '旧版链接' : reviewStatus(status, now)}
      adopted={status.state === 'merged'} author={merge} identity={identity} sharePath={sharePath} />
    <div className="kb-review-notices">
      {outdated && <p role="status">此链接所指的版本已经更新。</p>}
      {!outdated && !current && <p role="status">内容已修改，提交新版本后可以继续审核。</p>}
      {readError && <p role="alert" className="form-error">{readError} <button type="button" className="text-button" onClick={onChanged}>重试</button></p>}
      {writeError && <p role="alert" className="form-error">{writeError}</p>}
      {vote?.pending === 'choice' && <p role="status">本次修改有并行候选，可在版本协作中查看。</p>}
      {vote?.pending === 'conflict' && <p role="status">主分支也有修改，请在版本协作中处理冲突。</p>}
      {bundle && <p role="status">这项旧审核包含多篇文档。请逐篇重新提交审核。</p>}
      {!outdated && current && !readError && !changes && <p role="status">正在读取变更…</p>}
      {outdated && current && status.state === 'open' && <button className="button" onClick={onOpenCurrent}>查看当前审核</button>}
      {status.state === 'open' && (bundle || !current || status.approval_count >= 3) &&
        <button className="button quiet" onClick={onCollaborate}>打开分支</button>}
    </div>
    {changes?.map(change => {
      const currentVersion = change.current && change.current.id !== change.proposed.id && !change.current.deleted && !change.proposed.deleted ? change.current : null;
      const originalLines = currentVersion && new Set(currentVersion.body.split('\n'));
      const renamed = currentVersion && currentVersion.title !== change.proposed.title;
      return <section className="kb-diff kb-review-page" key={change.document_id}>
        {(bundle || change.proposed.title !== merge.title) && <h2>{change.proposed.title}</h2>}
        {change.conflict && <p className="form-error">已入库的文档也有修改。</p>}
        {!!change.proposed.deleted && <p className="kb-review-removal">拟移除的文档</p>}
        {merge.reason && merge.reason !== '提交审核' && <p className="kb-review-reason"><span>提交说明</span>{merge.reason}</p>}
        <KnowledgeDocumentBody document={change.proposed} branchId={merge.branch_id} api={api} writable={identity.can_write}
          identity={identity} onIssue={onIssue} review={{id: merge.id, head_id: merge.head_id}} revision={revision}
          lineClassName={originalLines ? line => originalLines.has(line) ? undefined : 'kb-line-added' : undefined}
          renderBody={body => currentVersion ? <KnowledgeReviewComparison
            current={<>{renamed && <h4>{currentVersion.title}</h4>}
              <ReviewTags version={currentVersion}/><StaticVersionBody body={currentVersion.body} proposedBody={change.proposed.body}/>
            </>}
            proposed={<>{renamed && <h4>{change.proposed.title}</h4>}
              <ReviewTags version={change.proposed}/>{body}
            </>}
          /> : <div className="kb-review-reading"><ReviewTags version={change.proposed}/>{body}</div>}
          footer={bundle ? canResubmit && <button className="button" disabled={busy} onClick={() => resubmit(change)}>单独提交这篇文档</button> : ballot} />
      </section>;
    })}
  </article>;
}

function ReviewTags({version}: {version: KnowledgeVersion}) {
  return version.tags?.length ? <div className="kb-review-version-tags">{version.tags.map(tag => <TagChip key={tag.id} tag={tag}/>)}</div> : null;
}

function StaticVersionBody({body, proposedBody}: {body: string; proposedBody: string}) {
  const proposedLines = new Set(proposedBody.split('\n'));
  return <div className="kb-body">{body.split('\n').map((line, i) => {
    if (!line.trim()) return null;
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    const removed = proposedLines.has(line) ? undefined : 'kb-line-removed';
    return heading ? <h2 key={i} className={removed}>{heading[1]}</h2> :
      <p key={i} className={removed ? 'kb-text ' + removed : 'kb-text'}>{line}</p>;
  })}</div>;
}

type ReviewBarProps = {
  api: KnowledgeApi;
  actorId: string;
  branch: KnowledgeBranch;
  document: KnowledgeVersion;
  merge?: KnowledgeMerge;
  now: number;
  onSubmitted: (branch: string, merge: string, head: string) => void;
  onMerged: () => void;
  onChanged: () => void;
  onBranches: () => void;
};

export function KnowledgeReviewBar({api, actorId, branch, document, merge, now, onSubmitted, onMerged, onChanged, onBranches}: ReviewBarProps) {
  const [submitting, setSubmitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [approved, setApproved] = useState(false);
  if (branch.id === 'main' || branch.state !== 'open') return null;
  const current = merge?.state === 'open' && merge.head_id === branch.head_id && merge.changes?.some(change => change.document_id === document.document_id);
  if (!current && branch.owner_id !== actorId) return null;
  const canApprove = current && !votingClosed(merge, now) && merge.changes?.length === 1;
  const deadline = current && reviewDeadline(merge, now);

  async function approve() {
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.write('/merges/approve', {id: merge.id, head_id: merge.head_id});
      setApproved(true);
      if (result.merged) onMerged();
      else onChanged();
    } catch (error) {
      setError((error as Error).message);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await api.write('/reviews', {
        branch_id: branch.id,
        expected_version: branch.version,
        document_id: document.document_id,
        version_id: document.id,
        reason: String(form.get('reason') ?? ''),
      });
      setSubmitting(false);
      onSubmitted(result.branch_id, result.id, result.head_id);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <footer className="kb-review-bar">
    {!submitting && error && <p role="alert" className="form-error">{error}</p>}
    {current ? <>
      <div className="kb-review-progress">
        <span>{reviewStatus(merge, now)} · {merge.approval_count} / 3 人认可{deadline && <>{' · '}<time dateTime={merge.expires_at!}>{deadline}</time></>}</span>
        <button className="text-button" onClick={onBranches}>查看审核</button>
      </div>
      {canApprove && <button className="button primary" disabled={busy || approved || !!merge.approved_by_me} onClick={approve}>{approved || merge.approved_by_me ? '我已认可' : '认可此版本'}</button>}
    </> : <button className="button primary" onClick={() => {setError(''); setSubmitting(true);}}>提交到审核</button>}
    {submitting && <Modal title="提交到审核" onClose={() => setSubmitting(false)} wide busy={busy}>
      <form className="kb-form kb-review-preview" onSubmit={submit}>
        <h3>{document.title}</h3>
        <p className="kb-muted">公开这篇文档供正式成员审核。七天内获得三人同意即可入库。</p>
        <div className="kb-review-copy">{document.body}</div>
        <label>提交说明（可选）<textarea name="reason" rows={2} maxLength={4000} /></label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <ModalActions><button className="button primary" disabled={busy}>公开并提交审核</button></ModalActions>
      </form>
    </Modal>}
  </footer>;
}
