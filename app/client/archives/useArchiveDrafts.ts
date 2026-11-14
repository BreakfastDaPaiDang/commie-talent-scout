import { useEffect, useState } from 'react';
import { api } from "../api";
export function useArchiveDrafts() {
  const [draftIds, setDraftIds] = useState<string[]>([]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        api<{
          drafts: {
            archive_id: string;
          }[];
        }>('/drafts').then(r => setDraftIds(r.drafts.map(d => d.archive_id))).catch(() => {});
      }, 500);
    };
    refresh();
    window.addEventListener('cts-drafts-changed', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('cts-drafts-changed', refresh);
    };
  }, []);
  return {
    draftIds
  };
}
