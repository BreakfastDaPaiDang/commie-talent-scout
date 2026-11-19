import React, {useId, useState} from 'react';
import {Avatar} from './Avatar';
import {Icon} from './icons';
import './personnel-recognition.css';

type RecognitionVoter = {
  id: string;
  name: string;
  avatarSrc?: string;
  avatarFallbackSrc?: string;
};

export function RecognitionIdentity({name, avatarSrc, avatarFallbackSrc}: Omit<RecognitionVoter, 'id'>) {
  return <span className="recognition-identity">
    <span aria-hidden="true"><Avatar name={name} src={avatarSrc} fallbackSrc={avatarFallbackSrc} size="micro" /></span>
    <span>{name}</span>
  </span>;
}

export function RecognitionSummary({count, required = 3, voters, previousRound, reviewTask, children}: {
  count: number;
  required?: number;
  voters: RecognitionVoter[];
  previousRound?: boolean;
  reviewTask?: {href: string; started: boolean};
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const recordsId = useId();
  if (!children && !reviewTask) return null;
  const started = reviewTask?.started;
  return <section className="personnel-recognition" aria-label="人员认可">
    <div className={`recognition-bar${started ? ' is-reviewing' : ''}`}>
      {children && <div className="recognition-heading">
        {started && <span className="recognition-mark"><Icon name="check" size={14} /></span>}
        <strong>{previousRound ? '上轮认可记录' : '人员认可'}</strong>
        {!previousRound && <span className="recognition-count" aria-live="polite"><strong>{count}</strong>/{required} 人</span>}
      </div>}
      {!previousRound && voters.length > 0 && <ul className="recognition-people" aria-label="认可成员">
        {voters.map(({id, ...voter}) => <li key={id}><RecognitionIdentity {...voter} /></li>)}
      </ul>}
      <div className="recognition-actions">
        {children && <button className="recognition-disclosure" type="button" aria-expanded={open} aria-controls={recordsId} onClick={() => setOpen(!open)}>
          {open ? '收起认可依据' : '查看认可依据'}<Icon name="down" size={14} />
        </button>}
        {reviewTask && <a className="recognition-task" href={reviewTask.href}>
          {started ? '已发起审核' : previousRound ? '查看上轮审核任务' : '查看人事审核任务'}<Icon name="arrow" size={14} />
        </a>}
      </div>
    </div>
    {children && <div id={recordsId} hidden={!open}>{children}</div>}
  </section>;
}
export function RecognitionButton({
  onClick,
  disabled = false
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return <button type="button" className="recognition-button" onClick={onClick} disabled={disabled}>认可此人</button>;
}
export function RecognitionConfirmation({
  name,
  version,
  remaining,
  limit,
  excerpt
}: {
  name: string;
  version: number;
  remaining: number;
  limit: number;
  excerpt: string;
}) {
  return <div className="recognition-confirmation"><p>依据这条观察，推荐 <strong>{name}</strong> 进入人事审核。</p><blockquote>{excerpt}</blockquote><p className="secondary-copy">观察版本 {version} · 本月剩余 {remaining}/{limit} 份</p><p>本次使用一份额度。满 3 名社员认可后，系统发起人事审核。</p></div>;
}

export function ComposerRecognitionOption({checked, disabled, onChange}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return <label className="recognition-composer-option">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
    同时认可此人
  </label>;
}
