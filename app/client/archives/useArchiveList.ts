import { type PersonScope } from "../../rules/archive-states";
import { useEffect, useRef, useState } from 'react';
import { api } from "../api";
import type { Preference, Kind, ListArchive } from './types';
export function useArchiveList({
  type,
  personScope,
  trash,
  detailOnly,
  pref
}: {
  type: Kind;
  personScope: PersonScope;
  trash: boolean;
  detailOnly: boolean;
  pref: Preference;
}) {
  const [items, setItems] = useState<ListArchive[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>();
  const request = useRef(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setRevision(n => n + 1), 750);
    };
    window.addEventListener('cts-reading-confirmed', changed);
    window.addEventListener('cts-reading-stale', changed);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('cts-reading-confirmed', changed);
      window.removeEventListener('cts-reading-stale', changed);
    };
  }, []);
  async function load(before?: string, refreshLoaded = false) {
    const sequence = ++request.current,
      target = refreshLoaded ? Math.max(30, items.length) : 30;
    setLoading(true);
    setError('');
    try {
      const collected: ListArchive[] = [];
      let next = before ?? null,
        totals: Record<string, number> | undefined;
      do {
        const r = await api<{
          archives: ListArchive[];
          next_cursor: string | null;
          counts?: Record<string, number>;
        }>('/archives?' + new URLSearchParams({
          type,
          person_scope: personScope,
          member_status: personScope === 'members' ? pref.status : '',
          deleted: String(trash),
          query: pref.query,
          scope: trash ? 'all' : pref.scope,
          status: personScope === 'members' ? '' : pref.status,
          member_id: pref.member_id,
          closed: personScope === 'members' ? 'all' : pref.closed,
          closed_history: trash || personScope === 'members' ? 'all' : pref.closed_history,
          tag_ids: pref.tag_ids.join(','),
          limit: String(Math.min(100, target - collected.length)),
          ...(next ? {
            before: next
          } : {})
        }));
        if (sequence !== request.current) return;
        collected.push(...r.archives);
        next = r.next_cursor;
        if (r.counts) totals = r.counts;
      } while (refreshLoaded && next && collected.length < target);
      setItems(old => before ? [...new Map([...old, ...collected].map(a => [a.id, a])).values()] : collected);
      setCursor(next);
      if (totals) setCounts(totals);
    } catch (e) {
      if (sequence === request.current) setError((e as Error).message);
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }
  const periodicReload = useRef(() => {});
  periodicReload.current = () => {
    if (!detailOnly && !loading && document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) void load(undefined, true);
  };
  useEffect(() => {
    const refresh = () => periodicReload.current(),
      timer = setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  useEffect(() => {
    if (!detailOnly) void load();
    return () => {
      request.current++;
    };
  }, [type, personScope, pref.query, pref.scope, pref.status, pref.member_id, pref.closed, pref.closed_history, pref.tag_ids.join(','), revision, detailOnly]);
  return {
    revision,
    setError,
    items,
    cursor,
    loading,
    error,
    counts,
    load,
    refresh: () => setRevision(n => n + 1)
  };
}
