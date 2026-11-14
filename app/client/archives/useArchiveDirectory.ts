import { useEffect, useState } from 'react';
import { api } from "../api";
import type { BoundMember } from "../../shared/archives";
export function useArchiveDirectory() {
  const [directory, setDirectory] = useState<BoundMember[]>([]),
    [directoryError, setDirectoryError] = useState(''),
    [directoryRetry, setDirectoryRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDirectoryError('');
    void (async () => {
      let before: string | null = null,
        all: BoundMember[] = [];
      do {
        const r: {
          members: BoundMember[];
          next_cursor: string | null;
        } = await api('/members?' + new URLSearchParams({
          limit: '100',
          ...(before ? {
            before
          } : {})
        }));
        all.push(...r.members);
        before = r.next_cursor;
      } while (before && !cancelled);
      if (!cancelled) setDirectory(all);
    })().catch(e => {
      if (!cancelled) setDirectoryError('成员筛选暂不可用：' + e.message);
    });
    return () => {
      cancelled = true;
    };
  }, [directoryRetry]);
  return {
    directory,
    directoryError,
    directoryRetry,
    setDirectoryRetry
  };
}
