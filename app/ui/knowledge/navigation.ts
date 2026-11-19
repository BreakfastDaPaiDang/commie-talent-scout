import { useCallback, useEffect, useRef, useState } from 'react';

export type Tab = 'content' | 'issues' | 'branches' | 'history';
export type Scope = 'all' | 'main' | 'public' | 'drafts' | 'branch';

type Navigation = {
  mode: 'simple' | 'git';
  scope: Scope;
  tab: Tab;
  branchId: string;
  documentId: string | null;
  issueId: string | null;
  reviewId: string | null;
  tagProposalId: string | null;
  reviewHead: string | null;
  mobileDetail: boolean;
};

function readNavigation(canWrite: boolean): Navigation {
  const params = new URLSearchParams(location.search);
  const requestedTab = params.get('tab');
  const tab = requestedTab === 'history' || (canWrite && (requestedTab === 'issues' || requestedTab === 'branches')) ? requestedTab : 'content';
  const mode = params.get('mode') === 'git' || tab !== 'content' ? 'git' : 'simple';
  const requestedScope = params.get('scope');
  const branchId = params.get('branch') || 'main';
  const reviewId = canWrite && mode === 'simple' ? params.get('review') : null;
  const reviewHead = reviewId ? params.get('head') : null;
  const tagProposalId = canWrite && mode === 'simple' && !reviewId ? params.get('tagProposal') : null;
  const issueId = tab === 'issues' ? params.get('issue') : null;
  const documentId = reviewId || tagProposalId ? null : params.get('document');
  let scope: Scope = 'main';
  if (canWrite && mode === 'simple') {
    // Old todo links include the same private drafts and candidates in the combined view.
    scope = requestedScope === 'main' && !reviewId && !tagProposalId && branchId === 'main' ? 'main' : 'all';
  } else if (canWrite) {
    if (requestedScope === 'public' || requestedScope === 'drafts' || requestedScope === 'main') scope = requestedScope;
    else if (params.has('branch')) scope = 'branch';
  }
  const mobileDetail = history.state?.knowledgeMobileDetail ?? !!(documentId || reviewId || tagProposalId || tab !== 'content');
  return {mode, scope, tab, branchId: tagProposalId ? 'main' : branchId, documentId, issueId, reviewId, reviewHead, tagProposalId, mobileDetail};
}

function writeNavigation(state: Navigation, method: 'push' | 'replace') {
  const url = new URL(location.href);
  const entries = {
    mode: state.mode,
    scope: state.scope === 'branch' ? null : state.scope,
    tab: state.tab === 'content' ? null : state.tab,
    issue: state.tab === 'issues' ? state.issueId : null,
    branch: state.branchId === 'main' ? null : state.branchId,
    document: state.documentId,
    review: state.reviewId,
    head: state.reviewId ? state.reviewHead : null,
    tagProposal: state.tagProposalId,
  };
  for (const [key, value] of Object.entries(entries)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (url.href === location.href && history.state?.knowledgeMobileDetail === state.mobileDetail) return;
  const data = {...history.state, knowledgeMobileDetail: state.mobileDetail};
  if (method === 'push') history.pushState(data, '', url);
  else history.replaceState(data, '', url);
}

export function useKnowledgeNavigation(canWrite: boolean) {
  const [state, setState] = useState(() => readNavigation(canWrite));
  const current = useRef(state);
  const pathname = useRef(location.pathname);
  const navigate = useCallback((update: Partial<Navigation>, method: 'push' | 'replace' = 'push') => {
    if (pathname.current !== location.pathname) return;
    const next = {...current.current, ...update};
    writeNavigation(next, method);
    current.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    function sync() {
      if (pathname.current !== location.pathname) return;
      const next = readNavigation(canWrite);
      writeNavigation(next, 'replace');
      current.current = next;
      setState(next);
    }
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [canWrite]);

  return {...state, navigate};
}
