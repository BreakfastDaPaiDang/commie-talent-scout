import type { ReactNode } from 'react';
import type { KnowledgeIdentity } from '../shared/knowledge';
import { Icon } from './icons';
import { KnowledgeAvatar } from './KnowledgeDocumentActivity';
import { ShareLink } from './ShareLink';

type ReviewHeaderProps = {
  title: string;
  status: string;
  adopted?: boolean;
  author: { author_id: string; author_name: string; created_at: string };
  identity: KnowledgeIdentity;
  sharePath?: string;
};

export function KnowledgeReviewHeader({title, status, adopted, author, identity, sharePath}: ReviewHeaderProps) {
  return <>
    <header className="kb-review-title">
      <h1>{title}</h1>
      <span className={'kb-review-state' + (adopted ? ' is-adopted' : '')}>{status}</span>
      {sharePath && <ShareLink key={sharePath} path={sharePath} label="分享审核" />}
    </header>
    <div className="kb-review-byline">
      <KnowledgeAvatar size="tiny" name={author.author_name} id={author.author_id} identity={identity} />
      <span>{author.author_name}</span>
      <time dateTime={author.created_at}>{new Date(author.created_at).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })}</time>
    </div>
  </>;
}

type ReviewBallotProps = {
  approval: { approval_count: number; approvers?: { id: string; name: string }[]; expires_at?: string | null };
  identity: KnowledgeIdentity;
  deadline: string;
  label?: string;
  approveLabel?: string;
  onApprove?: () => void;
  busy?: boolean;
  showMyApproval?: boolean;
  children?: ReactNode;
};

export function KnowledgeReviewBallot({
  approval, identity, deadline, label = '版本认可', approveLabel = '认可此版本', onApprove, busy, showMyApproval, children,
}: ReviewBallotProps) {
  return <section className="kb-review-ballot" aria-label={label}>
    <div className="kb-ballot-numbers" aria-label={approval.approval_count + ' / 3 人认可'}>
      <span>{label}</span><strong>{approval.approval_count}</strong><span> / 3 人</span>
    </div>
    {!!approval.approvers?.length && <ul className="kb-ballot-members" aria-label="认可成员">
      {approval.approvers.map(person => <li key={person.id}>
        <KnowledgeAvatar size="tiny" name={person.name} id={person.id} identity={identity} />{person.name}
      </li>)}
    </ul>}
    {deadline && <time dateTime={approval.expires_at ?? undefined}>{deadline}</time>}
    <div className="kb-review-buttons">
      {onApprove && <button type="button" className="button primary" onClick={onApprove} disabled={busy}>
        {busy ? '正在提交…' : approveLabel}
      </button>}
      {showMyApproval && <span className="kb-mine-vote"><Icon name="check" size={16}/>我已认可</span>}
      {children}
    </div>
  </section>;
}

export function KnowledgeReviewComparison({current, proposed}: {current: ReactNode; proposed: ReactNode}) {
  return <div className="kb-diff-columns">
    <section className="kb-review-version"><h3>已入库版本</h3>{current}</section>
    <section className="kb-review-version kb-proposed-version"><h3>修订版本</h3>{proposed}</section>
  </div>;
}
