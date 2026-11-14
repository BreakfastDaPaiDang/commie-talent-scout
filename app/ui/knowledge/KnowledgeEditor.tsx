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
      category: doc?.category_name ?? categories[0]?.name ?? '',
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
  const field = (name: keyof typeof defaults) => ({
    'aria-label': {
      title: '标题',
      body: '正文',
      category: '分类',
      kind: '条目类型',
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
      setError('请选择分类');
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
          ...fields
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
  return <Modal title={doc ? '修改文档' : '新条目'} onClose={close} busy={busy} wide><form className="kb-form kb-editor" onSubmit={save}><div className="kb-editor-meta"><div className="kb-category-field"><span id="kb-editor-category-label">分类</span><button type="button" className="button kb-category-choice" aria-labelledby="kb-editor-category-label" disabled={busy} onClick={() => setPickingCategory(true)}>{fields.category ? <TagChip tag={{
              name: fields.category
            }} /> : <span>选择分类</span>}<span className="kb-muted">选择</span></button></div><label>条目类型<input list="kb-kind-options" required maxLength={30} {...field('kind')} /><datalist id="kb-kind-options">{['知识', '共识', '方法', '案例', '题目', '需求', '资源'].map(name => <option key={name} value={name} />)}</datalist></label></div><label>标题<input required maxLength={200} {...field('title')} /></label><label>正文<textarea rows={13} required maxLength={60000} placeholder="写下内容。可用 ## 表示小标题。" {...field('body')} /></label><label>修改说明<textarea rows={2} required maxLength={300} placeholder="这次新增或修改了什么，为什么？" {...field('message')} /></label><details><summary>来源（可选）</summary><label>来源<input maxLength={2000} {...field('source')} /></label></details>{error && <p className="form-error" role="alert">{error}</p>}<ModalActions><button className="button primary" disabled={busy}>{busy ? '正在保存…' : simple ? '保存草稿' : '保存到分支'}</button></ModalActions></form>{pickingCategory && <KnowledgeCategoryEditor api={api} branchId={branch.id} close={() => setPickingCategory(false)} done={c => {
      setFields((old: typeof defaults) => ({
        ...old,
        category: c.name
      }));
      setPickingCategory(false);
    }} />}</Modal>;
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
