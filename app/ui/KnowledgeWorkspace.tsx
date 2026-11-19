import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { ShareLink } from './ShareLink';
import { KnowledgeDocumentBody } from './KnowledgeComments';
import { KnowledgeCategoryDrawer, KnowledgeCategoryEditor } from './KnowledgeCategories';
import { KnowledgeReviewBar, KnowledgeReviewDetail, reviewDeadline, reviewStatus } from './KnowledgeReview';
import { KnowledgeTagProposals } from './KnowledgeTagProposals';
import { KnowledgeHelp, KnowledgeHelpButton } from './KnowledgeHelp';
import { KnowledgeBranches, KnowledgeBranchForm, KnowledgeIssues, KnowledgeHistory } from './KnowledgeCollaboration';
import type { KnowledgeApi, KnowledgeCategory, KnowledgeIdentity, KnowledgeMerge, KnowledgeVersion } from '../shared/knowledge';
import { TagCatalog, TagChip } from './TagCatalog';
import { Modal } from './Modal';
import { KnowledgeEditor, RemoveDocument } from './knowledge/KnowledgeEditor';
import { useKnowledgeNavigation, type Tab, type Scope } from './knowledge/navigation';
import { useKnowledgeData } from './knowledge/data';
import './knowledge.css';
import './knowledge-workbench.css';

const versionTabs: [Tab, string][] = [
  ['content', '内容'], ['issues', '议题'], ['branches', '分支'], ['history', '历史'],
];

export function KnowledgeWorkspace({api, identity}: {api: KnowledgeApi; identity: KnowledgeIdentity}) {
  const canWrite = identity.can_write;
  const navigation = useKnowledgeNavigation(canWrite);
  const {
    scope, setScope, issueId, setIssueId, reviewId, setReviewId, reviewHead, setReviewHead,
    mode, setMode, branchId, setBranchId, documentId, setDocumentId, tab, setTab, mobileDetail, setMobileDetail,
  } = navigation;
  const {
    search, revision, merges, branches, items, setItems, categories, category, setCategory, query,
    setQuery, doc, setDoc, loading, loadingMerges, error, setError, refresh, more, next,
  } = useKnowledgeData(api, canWrite, navigation, mode === 'simple');
  const workspace = useRef<HTMLElement>(null);
  const detailScroll = useRef<HTMLDivElement>(null);
  const [newCategory, setNewCategory] = useState(false);
  const [notice, setNotice] = useState('');
  const [newBranch, setNewBranch] = useState(false);
  const [editor, setEditor] = useState<{document?: KnowledgeVersion} | null>(null);
  const [categoryPanel, setCategoryPanel] = useState<{tag: KnowledgeCategory; branchId: string} | null>(null);
  const [tagPicker, setTagPicker] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [tagBallotCount, setTagBallotCount] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [help, setHelp] = useState(false);
  const [now, setNow] = useState(Date.now);
  const branch = branches.find(b => b.id === branchId);
  const review = merges.find(merge => merge.id === reviewId);
  const todo = canWrite && mode === 'simple' && scope !== 'main';
  const visibleScope = scope === 'branch' ? branchId === 'main' ? 'main' : branch?.visibility === 'private' ? 'drafts' : 'public' : scope;
  const editable = branch?.state === 'open' && (branch.id === 'main' || branch.owner_id === identity.id);

  useEffect(() => {
    if (!canWrite) return;
    const timer = window.setTimeout(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (merges.some(merge => {
        if (merge.state !== 'open' || merge.voting_closed || !merge.expires_at) return false;
        const deadline = Date.parse(merge.expires_at);
        return now < deadline && deadline <= currentTime;
      })) refresh();
    }, 15_000);
    return () => window.clearTimeout(timer);
  }, [canWrite, merges, now, refresh]);

  useEffect(() => {
    detailScroll.current?.scrollTo(0, 0);
  }, [reviewId, documentId, branchId, tab]);

  const activeReviews = merges.filter(merge =>
    merge.state === 'open' && (reviewStatus(merge, now) !== '审核已过期' ||
      (merge.author_id === identity.id && (merge.changes?.length ?? 0) > 1)));
  const term = search.trim().toLocaleLowerCase();
  const visibleReviews = activeReviews.filter(merge =>
    (!category || merge.changes?.some(change => change.tags.some(tag => tag.id === category))) &&
    (!term || [merge.title, merge.reason, ...(merge.changes ?? []).flatMap(change => [change.title, ...change.tags.map(tag => tag.name)])]
      .some(value => value?.toLocaleLowerCase().includes(term))));
  const myReviews: KnowledgeMerge[] = [];
  const otherReviews: KnowledgeMerge[] = [];
  for (const merge of visibleReviews) {
    (reviewStatus(merge, now) === '我需认可' ? myReviews : otherReviews).push(merge);
  }
  const tags = new Map(categories.map(tag => [tag.id, tag]));
  const sourceBranches = new Map<string, string>();
  if (todo) {
    for (const merge of activeReviews) {
      for (const change of merge.changes ?? []) {
        for (const tag of change.tags) {
          if (!tags.has(tag.id)) tags.set(tag.id, {...tag, definition: '', count: 0, version: 0, updated_at: merge.updated_at});
          if (!sourceBranches.has(tag.id)) sourceBranches.set(tag.id, merge.branch_id);
        }
      }
    }
    for (const item of items) {
      for (const tag of item.tags ?? []) {
        if (item.branch_id && !sourceBranches.has(tag.id)) sourceBranches.set(tag.id, item.branch_id);
      }
    }
  }

  function clearSelection() {
    setReviewId(null);
    setReviewHead(null);
    setDocumentId(null);
    setDoc(null);
    setNotice('');
  }

  function selectTag(id: string) {
    if (id === category) return;
    clearSelection();
    setCategory(id);
    setItems([]);
    setMobileDetail(false);
  }

  function selectBranch(id: string) {
    setScope('branch');
    if (id === branchId && !reviewId) return;
    clearSelection();
    setBranchId(id);
    setItems([]);
    setCategory('');
    setCategoryPanel(null);
    setError('');
  }

  function selectScope(value: Scope) {
    clearSelection();
    setScope(value);
    setBranchId('main');
    setItems([]);
    setCategory('');
    setCategoryPanel(null);
    setTab('content');
    setMobileDetail(false);
  }

  function selectReview(id: string, head: string, bid: string) {
    clearSelection();
    setScope('todo');
    setReviewId(id);
    setReviewHead(head);
    setBranchId(bid);
    setTab('content');
    setMobileDetail(true);
    setError('');
  }

  function openTab(value: Tab) {
    setMode('git');
    setTab(value);
    setMobileDetail(true);
  }

  function openIssue(id: string) {
    openTab('issues');
    setReviewId(null);
    setReviewHead(null);
    setIssueId(id);
    setCategoryPanel(null);
    refresh();
  }

  function collaborateOnReview() {
    if (!review) return;
    selectBranch(review.branch_id);
    openTab('branches');
  }

  function changeMode() {
    if (mode === 'simple') {
      if (review) {
        collaborateOnReview();
      } else {
        if (todo) setScope('branch');
        openTab(documentId ? 'content' : 'branches');
      }
      return;
    }
    setMode('simple');
    setTab('content');
    if (branchId === 'main') {
      setScope(scope === 'drafts' || scope === 'public' ? 'todo' : 'main');
      setMobileDetail(!!documentId);
    } else {
      const candidate = activeReviews.find(merge => merge.branch_id === branchId);
      if (candidate) selectReview(candidate.id, candidate.head_id, candidate.branch_id);
      else {
        setScope('todo');
        setMobileDetail(!!documentId);
      }
    }
  }

  function selectDocument(id: string, bid: string) {
    setReviewId(null);
    setReviewHead(null);
    setDocumentId(id);
    setBranchId(bid);
    setTab('content');
    setMobileDetail(true);
    setError('');
    setNotice('');
  }

  function inspectTag(id: string) {
    const tag = tags.get(id);
    if (!tag) return;
    setTagPicker(false);
    const bid = sourceBranches.get(id) ?? (visibleScope === 'main' ? 'main' : branchId);
    setCategoryPanel({tag, branchId: bid});
  }

  function renderReviewGroup(title: string, group: KnowledgeMerge[]) {
    if (!group.length) return null;
    return <section className="kb-todo-group">
      <h2>{title}</h2>
      {group.map(merge => <button
        className={'kb-entry kb-review-entry ' + (merge.id === reviewId ? 'selected' : '')}
        key={merge.id}
        onClick={() => selectReview(merge.id, merge.head_id, merge.branch_id)}
      >
        <div>
          <h3>{merge.title}</h3>
          <p>{title === '我需认可' ? merge.author_name : reviewStatus(merge, now)} · {merge.approval_count} / 3 人同意</p>
          {merge.expires_at && <p><time dateTime={merge.expires_at}>{reviewDeadline(merge, now)}</time></p>}
        </div>
      </button>)}
    </section>;
  }

  const entries = items.map(item => {
    const bid = item.branch_id ?? branchId;
    return <button
      key={bid + item.document_id}
      className={'kb-entry ' + (item.document_id === documentId && bid === branchId ? 'selected' : '')}
      onClick={() => selectDocument(item.document_id, bid)}
    >
      <div>
        {todo ? <h3>{item.title}</h3> : <h2>{item.title}</h2>}
        <p>{item.body.replace(/^#+\s*/gm, '').replace(/\n/g, ' ')}</p>
      </div>
    </button>;
  });
  const openHelp = () => setHelp(value => !value);
  const modeLabel = mode === 'simple' ? '版本协作' : '返回普通视图';
  const documentTags = doc?.tags ?? (doc?.category_name ? [{id: doc.category_id!, name: doc.category_name}] : []);

  return <main ref={workspace} className={'kb-workspace ' + (mobileDetail ? 'kb-detail-visible ' : '') + (help ? 'kb-help-active' : '')}>
    <aside className="kb-list-pane" aria-label="知识库文档">
      <header className="kb-list-head">
        <h1>知识库</h1>
        {canWrite && <button data-kb-help="new-entry" className="button primary" onClick={() => setEditor({})}>＋ 新文档</button>}
        <KnowledgeHelpButton list active={help} onClick={openHelp} />
      </header>
      {mode === 'git' && <section className="kb-branch-box" aria-label="当前分支"><div>
        <span aria-hidden="true">⑂</span>
        <select aria-label="当前分支" value={branchId} onChange={event => selectBranch(event.target.value)}>
          {branches.map(b => <option key={b.id} value={b.id}>{b.id === 'main' ? '主分支' : b.name}{b.id !== 'main' && b.visibility === 'private' ? ' · 私人' : ''}</option>)}
        </select>
      </div></section>}
      <div className="kb-list-navigation">
        <nav className="kb-library-views" aria-label="知识库范围">
          {mode === 'simple' ? <>
            {canWrite && <button data-kb-help="scope-todo" className={todo ? 'active' : ''} aria-pressed={todo} onClick={() => {if (!todo) selectScope('todo');}}>待办</button>}
            <button data-kb-help="scope-main" className={!todo ? 'active' : ''} aria-pressed={!todo} onClick={() => {if (todo) selectScope('main');}}>已入库</button>
          </> : <>
            <button data-kb-help="scope-main" className={visibleScope === 'main' ? 'active' : ''} aria-pressed={visibleScope === 'main'} onClick={() => selectScope('main')}>主分支</button>
            {canWrite && <>
              <button data-kb-help="scope-public" className={visibleScope === 'public' ? 'active' : ''} aria-pressed={visibleScope === 'public'} onClick={() => selectScope('public')}>公开审核</button>
              <button data-kb-help="scope-drafts" className={visibleScope === 'drafts' ? 'active' : ''} aria-pressed={visibleScope === 'drafts'} onClick={() => selectScope('drafts')}>我的草稿</button>
            </>}
          </>}
        </nav>
        {canWrite && <button className="button quiet kb-list-collaboration" onClick={changeMode}>{modeLabel}</button>}
      </div>
      <div className="kb-list-filters">
        <div className="kb-search">
          <Icon name="search" size={18} />
          <input type="search" aria-label="搜索知识库" placeholder={todo ? '搜索待办' : '搜索文档'} value={query} onChange={event => setQuery(event.target.value)} maxLength={100} />
        </div>
        <button className="button quiet kb-tag-filter" aria-label="标签筛选" aria-haspopup="dialog" data-kb-help="tags" onClick={() => {setTagQuery(''); setTagPicker(true);}}>
          {tags.get(category)?.name ?? '标签筛选'}
        </button>
        {category && <button className="button quiet kb-clear-tag" aria-label="清除标签筛选" onClick={() => selectTag('')}>×</button>}
      </div>
      {(loading || (todo && loadingMerges)) && <p className="kb-list-message" role="status">正在读取…</p>}
      <div className="kb-entries">
        {todo ? <>
          {renderReviewGroup('我需认可', myReviews)}
          {!category && <KnowledgeTagProposals api={api} revision={revision} onChanged={refresh} canWrite={canWrite} search={search} onCount={setTagBallotCount} />}
          {items.length > 0 && <section className="kb-todo-group"><h2>我的草稿</h2>{entries}</section>}
          {renderReviewGroup('其他待认可', otherReviews)}
        </> : entries}
        {!loading && !(todo && loadingMerges) && !items.length && (!todo || (!visibleReviews.length && (category || !tagBallotCount))) &&
          <p className="kb-list-message">{search || category ? '没有符合条件的文档。' : todo ? '没有待审文档或个人草稿。' : visibleScope === 'drafts' ? '还没有草稿。' : visibleScope === 'public' ? '暂无公开候审的文档。' : '还没有已入库文档。'}</p>}
        {next !== null && <button className="button quiet" onClick={more}>{todo ? '加载更多草稿' : '加载更多文档'}</button>}
      </div>
    </aside>

    <section className="kb-detail-pane" aria-label="知识库内容">
      <div ref={detailScroll} className="kb-detail-scroll">
        <header className="kb-detail-toolbar">
          <button className="kb-mobile-back text-button" onClick={() => setMobileDetail(false)}>← 文档</button>
          {mode === 'simple' && <div className="kb-document-tags" aria-label="文档标签">
            {documentTags.map(tag => <TagChip key={tag.id} tag={tag} />)}
          </div>}
          {canWrite && <div className="kb-view-switch"><button className="button quiet" onClick={changeMode}>{modeLabel}</button></div>}
          {doc && branch?.visibility !== 'private' && <ShareLink path={'/knowledge?' + new URLSearchParams({
            document: doc.document_id,
            ...(branchId !== 'main' ? {branch: branchId, mode: 'git'} : {}),
          })} label="分享文档" />}
          <KnowledgeHelpButton active={help} onClick={openHelp} />
        </header>
        {mode === 'git' && <nav className="kb-content-tabs" aria-label="知识库页面">
          {versionTabs.filter(([id]) => canWrite || id === 'content' || id === 'history').map(([id, title]) =>
            <button data-kb-help={'tab-' + id} key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => openTab(id)}>{title}</button>)}
        </nav>}
        {error && <div className="kb-notice error" role="alert">{error}<button className="text-button" onClick={refresh}>重试</button></div>}
        {notice && <div className="kb-notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
        {tab === 'content' && (mode === 'simple' && reviewId ? review ?
          <KnowledgeReviewDetail key={review.id + review.head_id} api={api} merge={review} actorId={identity.id} revision={revision}
            now={now} requestedHead={reviewHead} onChanged={refresh} onCollaborate={collaborateOnReview}
            onOpenCurrent={() => selectReview(review.id, review.head_id, review.branch_id)}
            onReadDocument={id => {selectScope('main'); selectDocument(id, 'main');}}
            onResubmitted={(id, head, bid) => {selectReview(id, head, bid); refresh();}} /> :
          <div className="kb-empty"><p role="status">{loadingMerges ? '正在读取审核…' : '无法打开该审核，可能已关闭或不可访问。'}</p></div> :
          doc ? <article className="kb-article">
            <div className="kb-article-title"><h1>{doc.title}</h1></div>
            <p className="kb-article-meta">
              {branchId === 'main' ? '当前共识' : branch?.visibility === 'private' ? '私人草稿' : branch?.state === 'merged' ? '已合入的分支版本' : '分支中的修改'}
              {mode === 'git' && branch && ' · ' + branch.name}
              <span>{doc.author_name}</span>
            </p>
            <KnowledgeDocumentBody key={branchId + doc.id} api={api} document={doc} branchId={branchId} writable={canWrite} identity={identity} onIssue={openIssue}
              footer={<div className="kb-document-actions">
                {(mode === 'git' || !canWrite) && <div>
                  {canWrite && <button data-kb-help="issues" className="text-button" onClick={() => openTab('issues')}>议题</button>}
                  <button data-kb-help="history" className="text-button" onClick={() => openTab('history')}>历史版本</button>
                </div>}
                {canWrite && editable && <button data-kb-help="edit" className="button" onClick={() => setEditor({document: doc})}>
                  <Icon name="edit" size={18} />{mode === 'git' ? '在分支中修改' : branch?.visibility === 'private' ? '编辑草稿' : '建议修改'}
                </button>}
                {canWrite && mode === 'git' && branchId !== 'main' && editable && <button data-kb-help="remove" className="text-button" onClick={() => setRemoving(true)}>移除文档</button>}
              </div>} />
          </article> : <div className="kb-empty">
            <p>{todo ? '选择一项审核或草稿。' : '选择一篇文档开始阅读。'}</p>
          </div>)}
        {tab === 'issues' && <KnowledgeIssues api={api} writable={canWrite} revision={revision} selectedId={issueId} onChanged={refresh} />}
        {tab === 'branches' && <KnowledgeBranches api={api} actorId={identity.id} branches={branches} branchId={branchId} writable={canWrite}
          revision={revision} now={now} onBranch={selectBranch} onChanged={refresh} onNew={() => setNewBranch(true)} onIssue={() => openTab('issues')}
          onReview={merge => {setMode('simple'); selectReview(merge.id, merge.head_id, merge.branch_id);}} />}
        {tab === 'history' && <KnowledgeHistory key={branchId + revision} api={api} branchId={branchId} />}
      </div>
      {tab === 'content' && !reviewId && doc && branch && canWrite && <KnowledgeReviewBar key={branchId + doc.id} api={api} branch={branch} document={doc}
        actorId={identity.id} now={now} merge={merges.find(m => m.branch_id === branchId && m.state === 'open')}
        onSubmitted={(bid, id, head) => {
          if (mode === 'simple') selectReview(id, head, bid);
          else {setScope('public'); selectDocument(doc.document_id, bid);}
          refresh();
        }}
        onMerged={() => {
          selectScope('main');
          selectDocument(doc.document_id, 'main');
          refresh();
        }}
        onChanged={refresh} onBranches={() => openTab('branches')} />}
    </section>

    {help && <KnowledgeHelp root={workspace} writable={canWrite} close={() => setHelp(false)} />}
    {newBranch && <KnowledgeBranchForm api={api} close={() => setNewBranch(false)} done={id => {
      setNewBranch(false);
      selectBranch(id);
      setMode('git');
      refresh();
    }} />}
    {editor && branch && <KnowledgeEditor api={api} identity={identity} branch={branch} document={editor.document} categories={categories}
      simple={mode === 'simple'} close={() => setEditor(null)} done={(id, bid) => {
        setEditor(null);
        selectBranch(bid);
        selectDocument(id, bid);
        setScope(mode === 'simple' ? 'todo' : 'branch');
        if (mode === 'simple') setNotice('草稿已保存，可在底部提交到审核。');
        refresh();
      }} />}
    {tagPicker && <Modal title="标签筛选" onClose={() => setTagPicker(false)}>
      <div className="tag-catalog-dialog kb-tag-picker">
        <TagCatalog query={tagQuery} onQuery={setTagQuery}
          items={[...tags.values()].filter(tag => (tag.name + ' ' + tag.definition).normalize('NFKC').toLocaleLowerCase().includes(tagQuery.normalize('NFKC').trim().toLocaleLowerCase()))
            .map(tag => ({...tag, description: tag.definition || '暂无标签解释'}))}
          loading={loading} selectedIds={category ? [category] : []} searchPlaceholder="搜索标签名称或解释"
          onSelect={id => {selectTag(id); setTagPicker(false);}} onInspect={inspectTag}
          onCreate={canWrite ? () => {setTagPicker(false); setNewCategory(true);} : undefined} createLabel="＋ 新建标签" />
      </div>
    </Modal>}
    {newCategory && <KnowledgeCategoryEditor api={api} branchId={branchId} startCreating initialName={tagQuery} close={() => setNewCategory(false)} done={tag => {
      setNewCategory(false);
      setCategoryPanel({tag, branchId});
      refresh();
    }} />}
    {categoryPanel && <KnowledgeCategoryDrawer key={categoryPanel.tag.id} api={api} category={categoryPanel.tag} branchId={categoryPanel.branchId}
      identity={identity} close={() => setCategoryPanel(null)}
      onChanged={tag => {setCategoryPanel({...categoryPanel, tag}); refresh();}} onIssue={openIssue} />}
    {removing && doc && branch && <RemoveDocument api={api} branch={branch} document={doc} close={() => setRemoving(false)} done={() => {
      setRemoving(false);
      setDocumentId(null);
      refresh();
    }} />}
  </main>;
}
