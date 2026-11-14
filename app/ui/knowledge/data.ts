import { useEffect, useRef, useState } from 'react';
import type { KnowledgeApi, KnowledgeBranch, KnowledgeCategory, KnowledgeVersion, KnowledgeMerge } from "../../shared/knowledge";
import type { useKnowledgeNavigation } from './navigation';
type Selection = Pick<ReturnType<typeof useKnowledgeNavigation>, 'scope' | 'branchId' | 'documentId' | 'setBranchId' | 'setDocumentId'>;
export function useKnowledgeData(api: KnowledgeApi, canWrite: boolean, {
  scope,
  branchId,
  documentId,
  setBranchId,
  setDocumentId
}: Selection) {
  const [merges, setMerges] = useState<KnowledgeMerge[]>([]);
  const [branches, setBranches] = useState<KnowledgeBranch[]>([]),
    [items, setItems] = useState<KnowledgeVersion[]>([]),
    [categories, setCategories] = useState<KnowledgeCategory[]>([]),
    [category, setCategory] = useState(''),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [next, setNext] = useState<number | null>(null),
    [revision, setRevision] = useState(0),
    [doc, setDoc] = useState<KnowledgeVersion | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const listKey = scope + '|' + branchId + '|' + category + '|' + search + '|' + revision,
    listCurrent = useRef(listKey);
  listCurrent.current = listKey;
  const refresh = () => setRevision(v => v + 1);
  useEffect(() => {
    let current = true;
    if (canWrite) api.read('/merges').then(r => {
      if (current) setMerges(r.merges);
    }).catch(e => {
      if (current) setError(e.message);
    });
    return () => {
      current = false;
    };
  }, [api, canWrite, revision]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 180);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    let current = true;
    api.read('/branches').then(r => {
      if (current) setBranches(r.branches);
    }).catch(e => {
      if (current) setError(e.message);
    });
    return () => {
      current = false;
    };
  }, [api, revision]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    const filter = new URLSearchParams({
      branch_id: branchId,
      ...(scope !== 'branch' ? {
        scope
      } : {}),
      search,
      ...(category ? {
        category_id: category
      } : {})
    });
    api.read('/documents?' + filter).then(r => {
      if (current) {
        setItems(r.documents);
        setCategories(r.categories);
        setNext(r.next_offset);
        setBranches(old => old.map(b => b.id === r.branch.id ? r.branch : b));
        if (category && !r.categories.some((c: KnowledgeCategory) => c.id === category)) setCategory('');
        if (!documentId && r.documents.length) {
          setDocumentId(r.documents[0].document_id);
          setBranchId(r.documents[0].branch_id ?? branchId);
        }
      }
    }).catch(e => {
      if (current) setError(e.message);
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [api, branchId, scope, category, search, revision]);
  useEffect(() => {
    let current = true;
    setDoc(null);
    if (documentId) api.read('/documents/' + documentId + '?branch_id=' + encodeURIComponent(branchId)).then(r => {
      if (current) setDoc(r.document);
    }).catch(e => {
      if (current) setError(e.message);
    });
    return () => {
      current = false;
    };
  }, [api, documentId, branchId, revision]);
  async function more() {
    try {
      const r = await api.read('/documents?' + new URLSearchParams({
        branch_id: branchId,
        ...(scope !== 'branch' ? {
          scope
        } : {}),
        search,
        offset: String(next),
        ...(category ? {
          category_id: category
        } : {})
      }));
      if (listCurrent.current === listKey) {
        setItems(old => [...old, ...r.documents]);
        setNext(r.next_offset);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return {
    search,
    revision,
    merges,
    branches,
    items,
    setItems,
    categories,
    category,
    setCategory,
    query,
    setQuery,
    doc,
    setDoc,
    loading,
    error,
    setError,
    refresh,
    more,
    next
  };
}
