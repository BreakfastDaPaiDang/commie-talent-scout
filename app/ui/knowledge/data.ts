import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnowledgeApi, KnowledgeBranch, KnowledgeCategory, KnowledgeMerge, KnowledgeTagProposal, KnowledgeVersion } from '../../shared/knowledge';
import type { Scope, useKnowledgeNavigation } from './navigation';

type ListScope = Exclude<Scope, 'all'>;
type DocumentPage = {
  documents: KnowledgeVersion[];
  categories: KnowledgeCategory[];
  next_offset: number | null;
};

function listFilter(scope: ListScope, branch: string, search: string, category: string) {
  return new URLSearchParams({
    branch_id: scope === 'branch' ? branch : 'main',
    ...(scope !== 'branch' ? {scope} : {}),
    search,
    ...(category ? {category_id: category} : {}),
  }).toString();
}

function useDocumentList(api: KnowledgeApi, filter: string | null, revision: number) {
  type ListState = {filter: string; revision: number; page?: DocumentPage; error: string};
  const [state, setState] = useState<ListState>();
  const [loadingMore, setLoadingMore] = useState(false);
  const pendingPage = useRef<symbol | null>(null);
  const view = state?.filter === filter ? state : undefined;
  const loading = filter !== null && view?.revision !== revision;
  const next = loading ? null : view?.page?.next_offset ?? null;

  useEffect(() => {
    setLoadingMore(false);
    if (filter === null) return;
    let current = true;
    api.read<DocumentPage>('/documents?' + filter).then(page => {
      if (current) setState({filter, revision, page, error: ''});
    }).catch(error => {
      if (current) setState(old => ({filter, revision, page: old?.filter === filter ? old.page : undefined, error: error.message}));
    });
    return () => {
      current = false;
      pendingPage.current = null;
    };
  }, [api, filter, revision]);

  async function more() {
    if (filter === null || next === null || pendingPage.current) return;
    const request = Symbol();
    pendingPage.current = request;
    setLoadingMore(true);
    try {
      const page = await api.read<DocumentPage>('/documents?' + filter + '&offset=' + next);
      if (pendingPage.current === request) setState(old => {
        if (!old?.page || old.filter !== filter || old.revision !== revision) return old;
        return {filter, revision, page: {...page, documents: [...old.page.documents, ...page.documents]}, error: ''};
      });
    } catch (error) {
      if (pendingPage.current === request) setState(old => old && {...old, error: (error as Error).message});
    } finally {
      if (pendingPage.current === request) {
        pendingPage.current = null;
        setLoadingMore(false);
      }
    }
  }

  return {items: view?.page?.documents ?? [], categories: view?.page?.categories ?? [], loading, error: loading ? '' : view?.error ?? '', next, loadingMore, more};
}

function useKnowledgeRead<T>(api: KnowledgeApi, path: string | null, revision: number) {
  const [result, setResult] = useState<{path: string; revision: number; data?: T; error?: string}>();
  useEffect(() => {
    if (!path) return;
    let current = true;
    api.read<T>(path).then(data => {
      if (current) setResult({path, revision, data});
    }).catch(error => {
      if (current) setResult({path, revision, error: error.message});
    });
    return () => { current = false; };
  }, [api, path, revision]);
  const view = result?.path === path ? result : undefined;
  return {data: view?.data, error: view?.error, loading: !!path && view?.revision !== revision};
}

type Selection = Pick<ReturnType<typeof useKnowledgeNavigation>, 'scope' | 'branchId' | 'documentId' | 'versionId' | 'tagProposalId'>;

export function useKnowledgeData(api: KnowledgeApi, canWrite: boolean, {scope, branchId, documentId, versionId, tagProposalId}: Selection) {
  const [branches, setBranches] = useState<KnowledgeBranch[]>([]);
  const [reviewResult, setReviewResult] = useState<{search: string; merges: KnowledgeMerge[]}>();
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [loadingMerges, setLoadingMerges] = useState(canWrite);
  const [reviewError, setReviewError] = useState('');
  const [branchError, setBranchError] = useState('');
  const all = canWrite && scope === 'all';
  const list = useDocumentList(api, listFilter(scope === 'all' ? 'main' : scope, branchId, search, category), revision);
  const drafts = useDocumentList(api, all ? listFilter('drafts', 'main', search, category) : null, revision);
  const reviewSearch = all ? search : '';
  const document = useKnowledgeRead<{document: KnowledgeVersion; historical?: boolean; reference_context?: string}>(api, documentId ?
    '/documents/' + encodeURIComponent(documentId) + '?' + new URLSearchParams({
      branch_id: branchId, ...(versionId === null ? {} : {version_id: versionId}),
    }) : null, revision);
  const versionMismatch = versionId !== null && !!document.data && document.data.document?.id !== versionId;
  const tagQueue = useKnowledgeRead<{proposals: KnowledgeTagProposal[]}>(api, all ? '/tag-proposals' : null, revision);
  const tagDetail = useKnowledgeRead<{proposal: KnowledgeTagProposal}>(api, all && tagProposalId ?
    '/tag-proposals/' + encodeURIComponent(tagProposalId) : null, revision);
  const refresh = useCallback(() => setRevision(v => v + 1), []);

  useEffect(() => {
    if (!canWrite) return;
    let current = true;
    setLoadingMerges(true);
    setReviewError('');
    const filter = reviewSearch ? '?' + new URLSearchParams({search: reviewSearch}) : '';
    api.read<{merges: KnowledgeMerge[]}>('/merges' + filter).then(result => {
      if (current) setReviewResult({search: reviewSearch, merges: result.merges});
    }).catch(error => {
      if (current) setReviewError(error.message);
    }).finally(() => {
      if (current) setLoadingMerges(false);
    });
    return () => { current = false; };
  }, [api, canWrite, revision, reviewSearch]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 180);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let current = true;
    setBranchError('');
    api.read<{branches: KnowledgeBranch[]}>('/branches').then(result => {
      if (current) setBranches(result.branches);
    }).catch(error => {
      if (current) setBranchError(error.message);
    });
    return () => { current = false; };
  }, [api, revision]);

  return {
    search, revision, branches, list, drafts, category, setCategory, query, setQuery, refresh,
    merges: reviewResult?.merges ?? [],
    reviewMatches: reviewResult?.search === reviewSearch,
    loadingMerges,
    reviewError,
    tagQueue, tagDetail,
    doc: versionMismatch ? null : document.data?.document ?? null,
    historical: !!document.data?.historical,
    publicReview: document.data?.reference_context === 'public',
    loadingDoc: document.loading,
    error: document.error || (versionMismatch ? '无法读取链接所指的文档版本' : branchError),
  };
}
