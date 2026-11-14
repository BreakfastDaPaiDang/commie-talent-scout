import { archivePath } from "../../rules/archive-states";
import { useState } from 'react';
import { api } from "../api";
import type { Archive } from "../../shared/archives";
import type { useArchiveNavigation } from './useArchiveNavigation';
export function useArchiveEditor({
  detailOnly,
  trash,
  choose,
  setNotice,
  refresh
}: {
  detailOnly: boolean;
  trash: boolean;
  choose: ReturnType<typeof useArchiveNavigation>['choose'];
  setNotice: (notice: string) => void;
  refresh: () => void;
}) {
  const [dialog, setDialog] = useState<'create' | Archive | null>(null),
    [stateDialog, setStateDialog] = useState<Archive | null>(null),
    [busy, setBusy] = useState(false);
  const [deletion, setDeletion] = useState<Archive | null>(null);
  const [editTab, setEditTab] = useState('profile');
  async function saved(id: string, changed: boolean, message?: string) {
    const r = await api<{
      archive: Archive;
    }>('/archives/' + id);
    if (!detailOnly && !trash && archivePath(r.archive) !== location.pathname) {
      const params = new URLSearchParams(location.search);
      params.set('archive', id);
      history.pushState(null, '', archivePath(r.archive) + '?' + params);
      window.dispatchEvent(new window.PopStateEvent('popstate'));
    }
    setDialog(null);
    setStateDialog(null);
    choose(id);
    refresh();
    setNotice(message ?? (changed ? '档案已保存' : '资料没有变化'));
  }
  async function refreshEditor(id: string) {
    const r = await api<{
      archive: Archive;
    }>('/archives/' + id);
    setDialog(current => current && current !== 'create' && current.id === id && current.version <= r.archive.version ? r.archive : current);
    refresh();
  }
  return {
    dialog,
    setDialog,
    stateDialog,
    setStateDialog,
    busy,
    setBusy,
    deletion,
    setDeletion,
    editTab,
    setEditTab,
    saved,
    refreshEditor
  };
}
