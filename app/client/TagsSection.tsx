import { TagEvidence, kindLabels } from './TagEvidence';
import { TagPicker } from './TagPicker';
import { TagDefinitionDialog } from './TagMaintenance';
import { TabList } from '../ui/Workspace';
import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Modal } from './Modal';
import { PageError } from './ConnectionPages';
import type { Archive } from '../shared/archives';
import type { TagBinding, TagLabel, Evidence } from '../shared/tags';
import { TagChip } from '../ui/TagCatalog';
export { TagEvidence } from './TagEvidence';
export { TagChip } from '../ui/TagCatalog';
type Kind = 'person' | 'org';
type Category = {
  id: string;
  name: string;
  description: string;
  enabled: number;
  deleted?: number;
  color: string;
};
export function TagSummary({
  tags,
  total = tags.length
}: {
  tags: TagLabel[];
  total?: number;
}) {
  const shown = [...tags].sort((a, b) => (a.focus || 4) - (b.focus || 4)).slice(0, 3);
  return <div className="tag-summary">{shown.map(t => <TagChip key={t.tag_id} tag={t} />)}{total > shown.length && <span className="tag-more">+{total - shown.length}</span>}</div>;
}
export function TagsSection({
  archive,
  onChanged,
  manage = false
}: {
  archive: Archive;
  onChanged: () => void;
  manage?: boolean;
}) {
  const [related, setRelated] = useState<string | null>(null);
  const [add, setAdd] = useState(false),
    [selected, setSelected] = useState<TagBinding | null>(null),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const pending = useRef<{
    signature: string;
    id: string;
  } | null>(null);
  async function save(changes: unknown[], focus?: string[]) {
    setBusy(true);
    setError('');
    const body = {
        archive_id: archive.id,
        expected_version: archive.version,
        changes,
        ...(focus ? {
          focus
        } : {})
      },
      signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = {
      signature,
      id: crypto.randomUUID()
    };
    try {
      const r = await api<{
        changed: boolean;
      }>('/archive-tags/update', {
        ...body,
        request_id: pending.current.id
      });
      pending.current = null;
      setSelected(null);
      setEditing(false);
      setAdd(false);
      setNotice(r.changed ? '标签已保存' : '标签没有变化');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const tags = archive.tags ?? [];
  if (!manage && !tags.length) return null;
  return <section className={'archive-tags ' + (manage ? 'tag-management' : '')}>{manage && <header><h2>标签</h2>{!archive.closed && !archive.deleted && <button className="button" onClick={() => {
        setError('');
        setAdd(true);
      }}>＋ 添加</button>}</header>}<PageError error={error} retry={onChanged} retryLabel="刷新档案版本" />{notice && <p className="form-notice" role="status">{notice}</p>}
  {tags.length ? <div className="tag-bindings">{tags.map(t => <button key={t.tag_id} className="tag-binding-button" onClick={() => {
        setSelected(t);
        setEditing(false);
        setError('');
      }}><TagChip tag={t} />{t.deleted || t.category_deleted ? <small>已删除</small> : (!t.enabled || !t.category_enabled) && <small>已停用</small>}{t.merged_into && <small>已有合并去向</small>}</button>)}</div> : <p className="archive-no-contact">暂未记录标签</p>}
  {add && <Modal title="添加标签" busy={busy} onClose={() => setAdd(false)}><TagChooser type={archive.type} boundIds={tags.map(t => t.tag_id)} onSelect={async id => {
        await save([{
          tag_id: id,
          action: 'add'
        }]);
      }} /><PageError error={error} retry={onChanged} retryLabel="刷新档案版本后重试" /></Modal>}
  {selected && <Modal title={`${selected.category_name}：${selected.name}`} busy={busy} onClose={() => setSelected(null)}><div className="tag-detail"><p className="tag-description">{selected.description}</p>{selected.merged_into && <button className="button quiet" onClick={() => setRelated(selected.merged_into)}>查看合并去向</button>}<section className="tag-detail-evidence"><h3>判断依据</h3>{editing ? <EvidenceForm initial={selected.evidence} archiveId={archive.id} busy={busy} onSave={evidence => save([{
            tag_id: selected.tag_id,
            action: 'evidence',
            evidence
          }])} /> : <TagEvidence items={selected.evidence} />}</section><p className="tag-confirmed">最近确认 {new Date(selected.confirmed_at).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          })}</p><PageError error={error} retry={onChanged} retryLabel="刷新档案版本" />{!archive.closed && !archive.deleted && !editing && <div className="tag-actions"><button className="button" disabled={busy} onClick={() => setEditing(true)}>维护依据</button><button className="button" disabled={busy || !selected.focus && tags.filter(t => t.focus > 0).length >= 3} onClick={() => {
            const focused = tags.filter(t => t.focus > 0).sort((a, b) => a.focus - b.focus).map(t => t.tag_id);
            void save([], selected.focus ? focused.filter(id => id !== selected.tag_id) : [...focused, selected.tag_id]).catch(() => {});
          }}>{selected.focus ? '取消重点' : '设为重点'}</button><button className="button quiet" disabled={busy} onClick={() => void save([{
            tag_id: selected.tag_id,
            action: 'remove'
          }]).catch(() => {})}>移除此档案的绑定</button></div>}</div></Modal>}
 {related && <TagDefinitionDialog entityType="tag" id={related} onClose={() => setRelated(null)} onChanged={onChanged} />}
 </section>;
}
function EvidenceForm({
  initial,
  archiveId,
  busy,
  onSave
}: {
  initial: Evidence[];
  archiveId: string;
  busy: boolean;
  onSave: (evidence: Evidence[]) => Promise<void>;
}) {
  const [items, setItems] = useState<Evidence[]>(initial),
    [records, setRecords] = useState<{
      id: string;
      content_version: number;
      body: string;
    }[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState('');
  async function load(before?: string) {
    try {
      const r = await api<{
        observations: typeof records;
        next_cursor: string | null;
      }>('/observations?' + new URLSearchParams({
        archive_id: archiveId,
        ...(before ? {
          before
        } : {})
      }));
      setRecords(old => before ? [...old, ...r.observations] : r.observations);
      setCursor(r.next_cursor);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [archiveId]);
  function change(i: number, patch: Partial<Evidence>) {
    setItems(old => old.map((e, n) => n === i ? {
      ...e,
      ...patch
    } : e));
  }
  return <form className="manage-form" onSubmit={e => {
    e.preventDefault();
    void onSave(items).catch(() => {});
  }}><p>保留来源引用；独立材料需明确说明出处和范围。</p>{items.map((e, i) => <fieldset key={i}><legend>依据 {i + 1}</legend><label>来源种类<select value={e.kind} onChange={v => change(i, {
          kind: v.target.value as Evidence['kind']
        })}>{Object.entries(kindLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label>说明<textarea required maxLength={2000} rows={3} value={e.note} onChange={v => change(i, {
          note: v.target.value
        })} /></label><label>引用观察<select value={e.observation_id ?? ''} onChange={v => {
          const r = records.find(r => r.id === v.target.value);
          if (r) change(i, {
            observation_id: r.id,
            content_version: r.content_version
          });
        }}><option value="" disabled={!!e.observation_id}>{e.kind === 'observation' ? '请选择来源观察' : '本次独立材料，无观察引用'}</option>{e.observation_id && !records.some(r => r.id === e.observation_id) && <option value={e.observation_id}>已有引用 · 版本 {e.content_version}</option>}{records.map(r => <option key={r.id} value={r.id}>{r.body.slice(0, 60)} · 版本 {r.content_version}</option>)}</select></label><button type="button" className="button quiet" onClick={() => setItems(old => old.filter((_, n) => n !== i))}>移除这条依据</button></fieldset>)}{cursor && <button type="button" className="button quiet" onClick={() => void load(cursor)}>读取更多来源观察</button>}<button type="button" className="button" disabled={items.length >= 30} onClick={() => setItems(old => [...old, {
      kind: 'member_instruction',
      note: ''
    }])}>＋ 补充依据</button><PageError error={error} /><button className="button primary" disabled={busy || initial.length > 0 && !items.length}>{busy ? '正在保存…' : '保存依据'}</button></form>;
}
export function TagLibraryPage({
  isAdmin = false
}: {
  isAdmin?: boolean;
}) {
  const [scope, setScope] = useState('active');
  useEffect(() => {
    if (!isAdmin) setScope(s => s === 'deleted' ? 'active' : s);
  }, [isAdmin]);
  const [type, setType] = useState<Kind>('person'),
    [revision, setRevision] = useState(0);
  return <main className="tag-library"><p className="eyebrow">共享词义 · 按需维护</p><h1>标签库</h1><p>人物与组织分别维护。先读描述，再选择适合的词义。</p><TabList id="tag-library" value={type} onChange={value => setType(value as Kind)} label="标签库" items={[{
      key: 'person',
      label: '人物标签'
    }, {
      key: 'org',
      label: '组织标签'
    }]} /><section role="tabpanel" id="tag-library-timeline" aria-labelledby={`tag-library-tab-${type}`}><label className="tag-search">词库范围<select value={scope} onChange={e => setScope(e.target.value)}><option value="active">可用词库</option><option value="disabled">含停用项</option>{isAdmin && <option value="deleted">已删除</option>}</select></label><CategoryManagement key={type + scope} scope={scope} type={type} onChanged={() => setRevision(n => n + 1)} /><TagChooser key={type + scope + revision} type={type} includeDisabled={scope === 'disabled'} includeDeleted={scope === 'deleted'} allowCreate={scope !== 'deleted'} /></section></main>;
}
function CategoryManagement({
  type,
  scope,
  onChanged
}: {
  type: Kind;
  scope: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false),
    [items, setItems] = useState<Category[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    api<{
      categories: Category[];
    }>('/tag-categories?' + new URLSearchParams({
      type,
      include_disabled: String(scope === 'disabled'),
      include_deleted: String(scope === 'deleted')
    })).then(r => setItems(r.categories)).catch(e => setError(e.message));
  }, [type, scope, revision]);
  return <div className="category-management"><button className="button quiet" onClick={() => setOpen(v => !v)}>维护类别</button>{open && <div className="category-choices">{items.map(c => <button className="button" key={c.id} onClick={() => setSelected(c.id)}>{c.name}{c.deleted ? ' · 已删除' : !c.enabled ? ' · 已停用' : ''}</button>)}</div>}<PageError error={error} />{selected && <TagDefinitionDialog entityType="category" id={selected} onClose={() => setSelected(null)} onChanged={() => {
      setRevision(n => n + 1);
      onChanged();
    }} />}</div>;
}
export function TagChooser(props: React.ComponentProps<typeof TagPicker>) {
  const [inspected, setInspected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  return <>{inspected && <TagDefinitionDialog entityType="tag" id={inspected} onClose={() => setInspected(null)} onChanged={() => setRevision(n => n + 1)} />}<TagPicker {...props} refreshKey={revision} onInspect={setInspected} /></>;
}
