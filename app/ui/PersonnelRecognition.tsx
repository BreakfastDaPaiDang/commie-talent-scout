import React from 'react';
import './personnel-recognition.css';
export function RecognitionProgress({count, previousRound, taskHref, children}: {
  count: number;
  previousRound?: boolean;
  taskHref?: string;
  children?: React.ReactNode;
}) {
  if (!children && !taskHref) return null;
  const label = previousRound ? '上轮认可记录' : count > 0 ? `已有 ${count} 人认可` : '认可记录';
  return <section className="personnel-recognition" aria-label="人员认可">
    {children && <details><summary>{label}</summary>{children}</details>}
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
  excerpt
}: {
  name: string;
  version: number;
  remaining: number;
  excerpt: string;
}) {
  return <div className="recognition-confirmation"><p>依据这条观察，推荐 <strong>{name}</strong> 进入人事审核。</p><blockquote>{excerpt}</blockquote><p className="secondary-copy">观察版本 {version} · 本月剩余 {remaining}/2 份</p><p>本次使用一份额度。满 3 名社员认可后，系统发起人事审核。</p></div>;
}
