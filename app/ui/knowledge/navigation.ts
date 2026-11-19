import { useEffect, useState } from 'react';
export type Tab = 'content' | 'issues' | 'branches' | 'history';
export type Scope = 'main' | 'public' | 'drafts' | 'branch' | 'todo';
export function useKnowledgeNavigation(canWrite: boolean) {
  const params = new URLSearchParams(location.search),
    requestedTab = params.get('tab'),
    [mode, setMode] = useState<'simple' | 'git'>(params.get('mode') === 'git' ? 'git' : 'simple'),
    [scope, setScope] = useState<Scope>(() => {
      const requested = params.get('scope');
      if (!canWrite) return 'main';
      if (requested === 'main') return 'main';
      if (requested === 'public' || requested === 'drafts') return mode === 'git' ? requested : 'todo';
      if (requested === 'todo' || params.has('review')) return 'todo';
      if (params.has('branch')) return 'branch';
      return params.has('document') || mode === 'git' ? 'main' : 'todo';
    }),
    [issueId, setIssueId] = useState<string | null>(params.get('issue')),
    [reviewId, setReviewId] = useState<string | null>(canWrite ? params.get('review') : null),
    [reviewHead, setReviewHead] = useState<string | null>(canWrite ? params.get('head') : null),
    [branchId, setBranchId] = useState(params.get('branch') ?? 'main'),
    [documentId, setDocumentId] = useState<string | null>(params.get('document'));
  const [tab, setTab] = useState<Tab>(requestedTab === 'history' || (canWrite && (requestedTab === 'issues' || requestedTab === 'branches')) ? requestedTab : 'content'),
    [mobileDetail, setMobileDetail] = useState(!!(documentId || issueId || reviewId));
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('mode', mode);
    if (scope !== 'branch') url.searchParams.set('scope', scope);else url.searchParams.delete('scope');
    if (tab === 'content') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    if (tab === 'issues' && issueId) url.searchParams.set('issue', issueId);
    else url.searchParams.delete('issue');
    if (branchId === 'main') url.searchParams.delete('branch');else url.searchParams.set('branch', branchId);
    if (documentId) url.searchParams.set('document', documentId);else url.searchParams.delete('document');
    if (reviewId) url.searchParams.set('review', reviewId);else url.searchParams.delete('review');
    if (reviewHead) url.searchParams.set('head', reviewHead);else url.searchParams.delete('head');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [mode, branchId, scope, documentId, tab, issueId, reviewId, reviewHead]);
  return {
    scope,
    setScope,
    issueId,
    setIssueId,
    reviewId,
    setReviewId,
    reviewHead,
    setReviewHead,
    mode,
    setMode,
    branchId,
    setBranchId,
    documentId,
    setDocumentId,
    tab,
    setTab,
    mobileDetail,
    setMobileDetail
  };
}
