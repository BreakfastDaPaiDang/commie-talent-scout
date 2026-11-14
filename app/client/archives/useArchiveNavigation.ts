import { memberBasicStates, archivePath, type PersonScope } from "../../rules/archive-states";
import type { ObservationFocus } from "../ObservationSection";
import { useEffect, useState } from 'react';
import type { Archive } from "../../shared/archives";
import type { ArchivePageProps, ListArchive } from './types';
import { defaults, preferences } from './preferences';
export function useArchiveNavigation({
  actor,
  type,
  trash,
  pageLabel,
  detailOnly,
  initialStatus,
  personScope,
  linked
}: Pick<ArchivePageProps, 'actor' | 'type' | 'pageLabel' | 'linked'> & {
  trash: boolean;
  detailOnly: boolean;
  initialStatus: string;
  personScope: PersonScope;
}) {
  const prefKey = `cts:${actor.id}:${type}:${trash ? 'trash' : pageLabel ?? 'archives'}`,
    [pref, setPref] = useState(() => {
      const saved = detailOnly ? defaults : preferences(prefKey),
        linkedId = linked?.archiveId ?? new URLSearchParams(location.search).get('archive'),
        next = {
          ...saved,
          status: initialStatus || (personScope === 'members' && !memberBasicStates.includes(saved.status as typeof memberBasicStates[number]) ? '' : saved.status)
        };
      return linkedId && /^[0-9a-f-]{36}$/i.test(linkedId) ? {
        ...next,
        selected: linkedId
      } : next;
    });
  const [query, setQuery] = useState(pref.query),
    [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Archive | null>(null);
  const [expanded, setExpanded] = useState(() => new URLSearchParams(location.search).has('observation'));
  const [focus, setFocus] = useState<ObservationFocus | undefined>(() => {
    const p = new URLSearchParams(location.search),
      version = Number(p.get('version'));
    return p.has('event') || p.has('observation') ? {
      event_id: p.get('event') ?? undefined,
      observation_id: p.get('observation') ?? undefined,
      content_version: Number.isInteger(version) && version > 0 ? version : undefined,
      query: p.get('highlight') ?? undefined,
      key: location.search
    } : undefined;
  });
  useEffect(() => {
    if (detailOnly) return;
    const sync = () => {
      const p = new URLSearchParams(location.search),
        id = p.get('archive'),
        version = Number(p.get('version'));
      if (id !== pref.selected) setSelected(null);
      setPref(old => ({
        ...old,
        selected: id
      }));
      setExpanded(p.has('observation'));
      setFocus(p.has('event') || p.has('observation') ? {
        event_id: p.get('event') ?? undefined,
        observation_id: p.get('observation') ?? undefined,
        content_version: Number.isInteger(version) && version > 0 ? version : undefined,
        query: p.get('highlight') ?? undefined,
        key: location.search
      } : undefined);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [detailOnly, pref.selected]);
  useEffect(() => {
    if (linked) {
      setPref(p => ({
        ...p,
        selected: linked.archiveId
      }));
      setFocus(linked.focus);
    }
  }, [linked?.archiveId, linked?.focus.key]);
  useEffect(() => {
    if (detailOnly) return;
    try {
      localStorage.setItem(prefKey, JSON.stringify(pref));
    } catch {/* Current-page preferences still work without storage. */}
  }, [prefKey, pref]);
  useEffect(() => {
    const timer = setTimeout(() => setPref(p => ({
      ...p,
      query
    })), 250);
    return () => clearTimeout(timer);
  }, [query]);
  function choose(id: string | null, match?: ListArchive['search_match']) {
    setNotice('');
    setExpanded(false);
    if (pref.selected !== id) setSelected(null);
    setPref(p => ({
      ...p,
      selected: id
    }));
    const next = match ? {
      observation_id: match.observation_id,
      query: pref.query,
      key: crypto.randomUUID()
    } : undefined;
    setFocus(next);
    if (!detailOnly) {
      const params = new URLSearchParams();
      if (id) params.set('archive', id);
      if (next) {
        params.set('observation', next.observation_id);
        params.set('highlight', next.query);
      }
      history.pushState(null, '', location.pathname + (params.size ? '?' + params : ''));
    }
  }
  function openTaskArchive(archive: import('../../shared/work-tasks').ArchivePreview, taskId: string, observationId?: string, contentVersion?: number) {
    const params = new URLSearchParams({
      archive: archive.id,
      task: taskId
    });
    if (new URLSearchParams(location.search).get('from') === 'tasks') params.set('from', 'tasks');
    if (observationId) params.set('observation', observationId);
    if (contentVersion) params.set('version', String(contentVersion));
    const path = archivePath(archive),
      previousPath = location.pathname;
    if (!detailOnly) history.pushState(null, '', path + '?' + params);
    if (!detailOnly && path !== previousPath) {
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    setPref(p => ({
      ...p,
      selected: archive.id
    }));
    setFocus({
      observation_id: observationId,
      content_version: contentVersion,
      key: crypto.randomUUID()
    });
  }
  useEffect(() => {
    if (!['档案已保存', '资料没有变化'].includes(notice)) return;
    const timer = setTimeout(() => setNotice(''), 2800);
    return () => clearTimeout(timer);
  }, [notice]);
  return {
    pref,
    setPref,
    query,
    setQuery,
    notice,
    setNotice,
    selected,
    setSelected,
    expanded,
    setExpanded,
    focus,
    setFocus,
    choose,
    openTaskArchive
  };
}
