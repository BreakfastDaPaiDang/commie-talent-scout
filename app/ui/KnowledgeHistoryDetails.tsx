import { useEffect, useState } from 'react';
import type { KnowledgeApi, KnowledgeCommitDetail, KnowledgeVersion } from '../shared/knowledge';
import { Modal } from './Modal';

export type VersionTarget = {branchId: string; commitId: string; documentId?: string};

export function KnowledgeVersionBody({version}: {version: KnowledgeVersion}) {
  return <p className="kb-prose">{version.deleted ? '此版本移除了文档' : version.body}</p>;
}

export function KnowledgeVersionModal({api, target, close}: {api: KnowledgeApi; target: VersionTarget; close: () => void}) {
  const {branchId, commitId, documentId} = target;
  const [detail, setDetail] = useState<KnowledgeCommitDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({branch_id: branchId, ...(documentId ? {document_id: documentId} : {})});
    api.read<KnowledgeCommitDetail>('/history/' + encodeURIComponent(commitId) + '?' + query)
      .then(result => { if (active) setDetail(result); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [api, branchId, commitId, documentId]);

  return <Modal title="版本内容" onClose={close} wide>
    <div className="kb-form">
      {error && <p className="form-error" role="alert">{error}</p>}
      {!detail && !error && <p className="kb-muted" role="status">正在读取版本…</p>}
      {detail && <>
        <h3>{detail.commit.message}</h3>
        {detail.changes.map(({document_id, after}) => after && <section key={document_id}>
          <h3>{after.title}</h3>
          <KnowledgeVersionBody version={after} />
        </section>)}
      </>}
    </div>
  </Modal>;
}
