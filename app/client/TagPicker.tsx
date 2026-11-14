import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import { PageError } from './ConnectionPages';
import type { TagDefinition } from '../shared/tags';
import { TagCatalog, TagDefinitionFields } from '../ui/TagCatalog';
type Kind = 'person' | 'org';
type Category = {
  id: string;
  name: string;
  description: string;
  enabled: number;
  deleted?: number;
  color: string;
};
export function TagPicker({
  type,
  boundIds = [],
  onSelect,
  allowCreate = true,
  selectLabel = '添加',
  includeDisabled = false,
  includeDeleted = false,
  onInspect,
  refreshKey = 0
}: {
  type: Kind;
  boundIds?: string[];
  onSelect?: (id: string) => Promise<void>;
  allowCreate?: boolean;
  selectLabel?: '添加' | '选择';
  includeDisabled?: boolean;
  includeDeleted?: boolean;
  onInspect?: (id: string) => void;
  refreshKey?: number;
}) {
  const [query, setQuery] = useState(''),
    [items, setItems] = useState<(TagDefinition & {
      binding_count: number;
    })[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [categories, setCategories] = useState<Category[]>([]),
    [create, setCreate] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [created, setCreated] = useState<string | null>(null);
  const serial = useRef(0);
  async function load(before?: string) {
    const n = ++serial.current;
    setLoading(true);
    try {
      const r = await api<{
        tags: typeof items;
        next_cursor: string | null;
      }>('/tags?' + new URLSearchParams({
        type,
        query,
        include_disabled: String(includeDisabled),
        include_deleted: String(includeDeleted),
        ...(before ? {
          before
        } : {})
      }));
      if (n === serial.current) {
        setItems(old => before ? [...old, ...r.tags] : r.tags);
        setCursor(r.next_cursor);
      }
    } catch (e) {
      if (n === serial.current) setError((e as Error).message);
    } finally {
      if (n === serial.current) setLoading(false);
    }
  }
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setError('');
    const timer = setTimeout(() => void load(), 200);
    return () => {
      serial.current++;
      clearTimeout(timer);
    };
  }, [type, query, revision, includeDisabled, includeDeleted, refreshKey]);
  useEffect(() => {
    api<{
      categories: Category[];
    }>('/tag-categories?type=' + type).then(r => setCategories(r.categories)).catch(e => setError(e.message));
  }, [type, revision, refreshKey]);
  async function select(id: string) {
    if (!onSelect) return;
    setBusy(true);
    setError('');
    try {
      await onSelect(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <><TagCatalog query={query} onQuery={setQuery} items={items.map(t => ({
      ...t,
      meta: <>{t.binding_count} 个可见绑定 · 定义版本 {t.version}</>,
      state: t.deleted || t.category_deleted ? '已删除' : !t.enabled || !t.category_enabled ? '已停用' : undefined
    }))} loading={loading} busy={busy} selectedIds={boundIds} selectLabel={selectLabel} onSelect={onSelect ? id => void select(id) : undefined} onInspect={!onSelect ? onInspect : undefined} onMore={cursor ? () => void load(cursor) : undefined} feedback={<><PageError error={error} retry={() => void load()} />{created && <p className="form-notice">词条已创建或复用{onSelect ? '，绑定失败时可继续重试。' : '。'}{onSelect && <button className="button" disabled={busy} onClick={() => void select(created)}>继续绑定已创建词条</button>}</p>}</>} onCreate={allowCreate ? () => setCreate(true) : undefined} createForm={allowCreate && create ? <TagCreateForm type={type} categories={categories} initial={query} onCreated={async id => {
      setCreated(id);
      setCreate(false);
      setRevision(n => n + 1);
      if (onSelect) await select(id);
    }} /> : undefined} /></>;
}
function TagCreateForm({
  type,
  categories,
  initial,
  onCreated
}: {
  type: Kind;
  categories: Category[];
  initial: string;
  onCreated: (id: string) => Promise<void>;
}) {
  const parts = initial.normalize('NFKC').split(':'),
    prefix = parts.length === 2 ? parts[0].trim() : '',
    chosen = categories.find(c => c.enabled && c.name.normalize('NFKC').toLowerCase() === prefix.toLowerCase());
  const [category, setCategory] = useState(prefix ? chosen?.id ?? 'new' : categories.find(c => c.enabled)?.id ?? 'new'),
    [categoryName, setCategoryName] = useState(prefix),
    [name, setName] = useState(parts.length === 2 ? parts[1].trim() : initial),
    [description, setDescription] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const categoryRequest = useRef(crypto.randomUUID()),
    tagRequest = useRef(crypto.randomUUID()),
    createdCategory = useRef<string | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      let id = category;
      if (id === 'new') {
        if (!createdCategory.current) {
          const r = await api<{
            id: string;
          }>('/tag-categories/create', {
            type,
            name: categoryName,
            color: 'sage',
            request_id: categoryRequest.current
          });
          createdCategory.current = r.id;
        }
        id = createdCategory.current;
      }
      const r = await api<{
        id: string;
      }>('/tags/create', {
        category_id: id,
        name,
        description,
        request_id: tagRequest.current
      });
      await onCreated(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <form className="manage-form tag-create-form" onSubmit={save}><h3>新建标签</h3><label>类别<select value={category} onChange={e => setCategory(e.target.value)} disabled={busy || !!createdCategory.current}>{categories.filter(c => c.enabled).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="new">＋ 新建类别</option></select></label>{category === 'new' && <label>类别名称<input required maxLength={24} value={categoryName} onChange={e => setCategoryName(e.target.value)} disabled={busy || !!createdCategory.current} /></label>}<TagDefinitionFields name={name} onName={setName} description={description} onDescription={setDescription} busy={busy} /><PageError error={error} /><button className="button primary" disabled={busy}>{busy ? '正在保存…' : '保存词条'}</button></form>;
}
