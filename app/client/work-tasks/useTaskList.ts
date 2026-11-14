import React, { useEffect, useState } from 'react';
import type { Task } from '../../shared/work-tasks';
import { fetchTaskList } from './queries';
export function useTaskList() {
  const [tasks, setTasks] = useState<Task[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [query, setQuery] = useState(''),
    [searchTasks, setSearchTasks] = useState<Task[] | null>(null),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState('');
  const loadSequence = React.useRef(0);
  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError('');
    try {
      const rows = await fetchTaskList();
      if (sequence === loadSequence.current) setTasks(rows);
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      loadSequence.current++;
    };
  }, [revision]);
  useEffect(() => {
    let cancelled = false;
    setSearchError('');
    setSearchTasks(query.trim() ? [] : null);
    setSearching(!!query.trim());
    if (!query.trim()) return;
    const timer = window.setTimeout(async () => {
      try {
        const rows = await fetchTaskList(query.trim());
        if (!cancelled) setSearchTasks(rows);
      } catch (e) {
        if (!cancelled) setSearchError((e as Error).message);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, revision]);
  const refresh = () => setRevision(n => n + 1);
  return {
    tasks,
    loading,
    error,
    query,
    setQuery,
    searchTasks,
    searching,
    searchError,
    load,
    refresh
  };
}
