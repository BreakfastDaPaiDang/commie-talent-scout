import { useEffect, useState } from 'react';
export type Tab = 'content' | 'issues' | 'branches' | 'history';
export type Scope = 'main' | 'public' | 'drafts' | 'branch';
export function useKnowledgeNavigation() {
  const params = new URLSearchParams(location.search),
    [scope, setScope] = useState<Scope>((['main', 'public', 'drafts'].includes(params.get('scope') ?? '') ? params.get('scope') : params.has('branch') ? 'branch' : 'main') as Scope),
    [issueId, setIssueId] = useState<string | null>(params.get('issue')),
    [mode, setMode] = useState<'simple' | 'git'>(params.get('mode') === 'git' ? 'git' : 'simple'),
    [branchId, setBranchId] = useState(params.get('branch') ?? 'main'),
    [documentId, setDocumentId] = useState<string | null>(params.get('document'));
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'issues' ? 'issues' : 'content'),
    [mobileDetail, setMobileDetail] = useState(!!documentId);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('mode', mode);
    if (scope !== 'branch') url.searchParams.set('scope', scope);else url.searchParams.delete('scope');
    if (tab === 'issues') {
      url.searchParams.set('tab', 'issues');
      if (issueId) url.searchParams.set('issue', issueId);
    } else {
      url.searchParams.delete('tab');
      url.searchParams.delete('issue');
    }
    if (branchId === 'main') url.searchParams.delete('branch');else url.searchParams.set('branch', branchId);
    if (documentId) url.searchParams.set('document', documentId);else url.searchParams.delete('document');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [mode, branchId, scope, documentId, tab, issueId]);
  return {
    scope,
    setScope,
    issueId,
    setIssueId,
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
