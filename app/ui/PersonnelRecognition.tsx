import React from 'react';
import './personnel-recognition.css';
export function RecognitionProgress({count, required = 3, previousRound, taskHref, children}: {
  count: number;
  required?: number;
  previousRound?: boolean;
  taskHref?: string;
  children?: React.ReactNode;
}) {
  if (!children && !taskHref) return null;
  const label = previousRound ? '上轮认可记录' : '人员认可';
  return <section className="personnel-recognition" aria-label="人员认可">
    {children && <details><summary>
      <span>{label}</span>
      {!previousRound && <>
        <progress max={required} value={count} aria-label="人员认可进度" />
        <span className="recognition-segments" aria-hidden="true">
          {Array.from({length: required}, (_, index) => <span key={index} className={index < count ? 'is-active' : undefined} />)}
        </span>
        <strong>{count}/{required}</strong>
      </>}
    </summary>{children}</details>}
    {taskHref && <a href={taskHref}>查看人事审核任务 ↗</a>}
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
