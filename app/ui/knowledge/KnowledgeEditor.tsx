import React, { useEffect, useRef, useState } from 'react';
import { Modal, ModalActions } from "../Modal";
import { KnowledgeCategoryEditor } from "../KnowledgeCategories";
import type { KnowledgeApi, KnowledgeBranch, KnowledgeCategory, KnowledgeIdentity, KnowledgeVersion } from "../../shared/knowledge";
import { TagChip } from "../TagCatalog";
export function KnowledgeEditor({
  api,
  identity,
  branch,
  document: doc,
  categories,
  simple,
  close,
  done
}: {
  api: KnowledgeApi;
  identity: KnowledgeIdentity;
  branch: KnowledgeBranch;
  document?: KnowledgeVersion;
  categories: KnowledgeCategory[];
  simple: boolean;
  close: () => void;
  done: (id: string, branch: string) => void;
}) {
  const draftKey = 'cts.knowledge.draft.' + identity.id + '.' + branch.id + '.' + (doc?.document_id ?? 'new'),
    defaults = {
      title: doc?.title ?? '',
      body: doc?.body ?? '',
      category: doc?.category_name ?? '',
      additional_tags: doc?.tags?.filter(tag => tag.id !== doc.category_id).map(tag => tag.name) ?? [] as string[],
      kind: doc?.kind ?? '知识',
      source: doc?.source ?? '',
      message: ''
    };
  const [fields, setFields] = useState(() => {
      try {
        return {
          ...defaults,
          ...JSON.parse(sessionStorage.getItem(draftKey) ?? 'null')
        };
      } catch {
        return defaults;
      }
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [pickingCategory, setPickingCategory] = useState(false);
  const [pickedTags,setPickedTags] = useState<KnowledgeCategory[]>([]);
  const knownTags = [...pickedTags,...categories,...(doc?.tags??[])];
  const progress = useRef<{
    id: string;
    version: number;
    documentId?: string;
  } | null>(doc && branch.id !== 'main' && branch.state === 'open' ? {
    id: branch.id,
    version: branch.version,
    documentId: doc.document_id
  } : null);
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(fields));
    } catch {}
  }, [fields, draftKey]);
  const field = (name: Exclude<keyof typeof defaults, 'additional_tags'>) => ({
    'aria-label': {
      title: '标题',
      body: '正文',
      category: '标签',
      kind: '文档类型',
      source: '来源',
      message: '修改说明'
    }[name],
    value: fields[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((old: typeof defaults) => ({
      ...old,
      [name]: e.target.value
    }))
  });
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fields.category.trim()) {
      setError('请选择标签');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!progress.current) {
        const b = await api.write('/branches', {
          name: fields.title.slice(0, 58) + ' · ' + crypto.randomUUID().slice(0, 6),
          visibility: 'private'
        });
        progress.current = {
          id: b.id,
          version: b.version,
          documentId: doc?.document_id
        };
      }
      const working = progress.current!,
        result = await api.write('/documents', {
          branch_id: working.id,
          expected_version: working.version,
          ...(working.documentId ? {
            document_id: working.documentId
          } : {}),
          ...fields,
          additional_tags: fields.additional_tags.length || (doc?.tags?.length ?? 0) > 1 ? fields.additional_tags : undefined,
          message: fields.message.trim() || (doc ? '修改文档' : '新增文档')
        });
      progress.current = {
        id: working.id,
        version: result.version,
        documentId: result.id
      };
      try {
        sessionStorage.removeItem(draftKey);
      } catch {}
      done(result.id, working.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const chosen = [fields.category, ...fields.additional_tags].filter(Boolean) as string[];
  function changeTags(names: string[]) {
    setFields((old: typeof defaults) => ({...old, category: names[0] ?? '', additional_tags: names.slice(1)}));
  }
  return <Modal title={doc ? '修改文档' : '新文档'} onClose={close} busy={busy} wide>
    <form className="kb-form kb-editor" onSubmit={save}>
      <label>标题<input required maxLength={200} {...field('title')} /></label>
      <div className="kb-editor-meta kb-editor-tags">
        <div className="kb-category-field"><span id="kb-editor-category-label">标签</span>
          <div className="kb-editor-tag-control">
            {chosen.map(name => <button type="button" key={name} className="kb-tag-remove"
              aria-label={'移除标签 ' + name} onClick={() => changeTags(chosen.filter(tag => tag !== name))}>
              <TagChip tag={knownTags.find(tag => tag.name === name) ?? {name}}/> <span aria-hidden="true">×</span>
            </button>)}
            <button type="button" className="kb-category-choice" aria-labelledby="kb-editor-category-label"
              disabled={busy || chosen.length >= 20} onClick={() => setPickingCategory(true)}>
              {chosen.length ? '＋ 添加标签' : '选择标签'}
            </button>
          </div>
        </div>
      </div>
      <label>正文<textarea rows={10} required maxLength={60000} placeholder="写下内容。可用 ## 表示小标题。" {...field('body')} /></label>
      <label>修改说明（可选）<textarea rows={2} maxLength={300} placeholder="这次修改了什么？" {...field('message')} /></label>
      <details><summary>来源（可选）</summary><label>来源<input maxLength={2000} {...field('source')} /></label></details>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ModalActions><button className="button primary" disabled={busy}>{busy ? '正在保存…' : simple ? '保存草稿' : '保存到分支'}</button></ModalActions>
    </form>
    {pickingCategory && <KnowledgeCategoryEditor api={api} branchId={branch.id} close={() => setPickingCategory(false)} done={c => {
      setPickedTags(previous => [c, ...previous.filter(tag => tag.id !== c.id)]);
      changeTags([...new Set([...chosen, c.name])]);
      setPickingCategory(false);
    }} />}
  </Modal>;
}
export function RemoveDocument({
  api,
  branch,
  document: doc,
  close,
  done
}: {
  api: KnowledgeApi;
  branch: KnowledgeBranch;
  document: KnowledgeVersion;
  close: () => void;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return <Modal title="从分支移除文档" onClose={close} busy={busy}><form className="kb-form" onSubmit={async e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      setBusy(true);
      try {
        await api.write('/documents/remove', {
          branch_id: branch.id,
          expected_version: branch.version,
          document_id: doc.document_id,
          message: f.get('message')
        });
        done();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }}><p>从“{branch.name}”移除“{doc.title}”。主分支在合入前保持原状，历史版本保留。</p><label>移除理由<textarea name="message" required maxLength={300} /></label>{error && <p className="form-error" role="alert">{error}</p>}<ModalActions><button className="button primary" disabled={busy}>确认移除</button></ModalActions></form></Modal>;
}
