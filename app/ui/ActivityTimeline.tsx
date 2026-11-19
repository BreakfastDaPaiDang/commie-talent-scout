import type { FocusEventHandler, FormEventHandler, ReactNode } from 'react';
import { Icon } from './icons';
import './activity-timeline.css';

export function ActivityHeading({as: Heading = 'h3', count}: {as?: 'h2' | 'h3'; count?: string}) {
  return <Heading className="task-history-title"><Icon name="file" />评论与历史 {count && <span>{count}</span>}</Heading>;
}

export function ActivityTimeline({children}: {children: ReactNode}) {
  return <div className="task-activity">{children}</div>;
}

export function ActivityCommentEntry({children}: {children: ReactNode}) {
  return <div className="task-activity-entry">{children}</div>;
}

export function ActivityEvent({label, byline, children}: {label: ReactNode; byline: ReactNode; children?: ReactNode}) {
  return <article className="task-activity-entry task-event-entry">
    <header><strong>{label}</strong>{byline}</header>
    {children}
  </article>;
}

export function ActivityComment({avatar, author, time, actions, children, composer}: {
  avatar: ReactNode;
  author: string;
  time: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  composer?: ReactNode;
}) {
  return <article className="work-task-comment">
    <header>{avatar}<strong>{author}</strong>{time}</header>
    {children}
    {actions && <footer>{actions}</footer>}
    {composer}
  </article>;
}

export function ActivityComposer({onSubmit, onBlur, className, leading = <Icon name="plus" />, children}: {
  onSubmit: FormEventHandler<HTMLFormElement>;
  onBlur?: FocusEventHandler<HTMLFormElement>;
  className?: string;
  leading?: ReactNode;
  children: ReactNode;
}) {
  return <form className={className ? 'task-comment-compose ' + className : 'task-comment-compose'}
    onSubmit={onSubmit} onBlur={onBlur}>{leading}{children}</form>;
}
