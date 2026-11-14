import React from 'react';
import './personnel-recognition.css';
export function RecognitionProgress({
  count,
  taskHref,
  children
}: {
  count: number;
  taskHref?: string;
  children?: React.ReactNode;
}) {
  return <section className="personnel-recognition" aria-label="人员认可"><div className="recognition-heading"><strong>人员认可 <span>{count}/3</span></strong>{taskHref ? <a href={taskHref}>查看人事审核任务 ↗</a> : <span className="secondary-copy">三名社员认可后发起审核</span>}</div>{children}</section>;
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
  return <div className="recognition-confirmation"><p>依据这条观察，推荐 <strong>{name}</strong> 进入人事审核。</p><blockquote>{excerpt}</blockquote><p className="secondary-copy">观察版本 {version} · 本月剩余 {remaining}/2 份</p><p>提交后占用一份额度；这不代表审核通过或正式入社。</p></div>;
}
