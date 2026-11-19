import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { ShareLink } from './ShareLink';
import { KnowledgeDocumentBody } from './KnowledgeComments';
import { KnowledgeAvatar } from './KnowledgeDocumentActivity';
import { KnowledgeCategoryDrawer, KnowledgeCategoryEditor } from './KnowledgeCategories';
import { KnowledgeReviewBar, KnowledgeReviewDetail, reviewDeadline, votingClosed } from './KnowledgeReview';
import { KnowledgeTagProposals } from './KnowledgeTagProposals';
import { KnowledgeHelp, KnowledgeHelpButton } from './KnowledgeHelp';
import { KnowledgeBranches, KnowledgeBranchForm, KnowledgeIssues, KnowledgeHistory } from './KnowledgeCollaboration';
import type { KnowledgeApi, KnowledgeCategory, KnowledgeIdentity, KnowledgeVersion } from '../shared/knowledge';
import { TagCatalog, TagChip } from './TagCatalog';
import { Modal } from './Modal';
import { KnowledgeEditor, RemoveDocument } from './knowledge/KnowledgeEditor';
import { useKnowledgeNavigation, type Tab, type Scope } from './knowledge/navigation';
import { useKnowledgeData } from './knowledge/data';
import './knowledge.css';
import './knowledge-workbench.css';
import './knowledge-index.css';

const versionTabs: [Tab, string][] = [
  ['content', '内容'], ['issues', '议题'], ['branches', '分支'], ['history', '历史'],
];
const noSelection = {documentId: null, reviewId: null, reviewHead: null, issueId: null};
const knowledgeDate = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'});

function Byline({name, at}: {name: string; at: string}) {
  return <><span>{name}</span><time dateTime={at}>{knowledgeDate.format(new Date(at))}</time></>;
}

function tagsFor(version: KnowledgeVersion) {
  return version.tags ?? (version.category_id && version.category_name ? [{id: version.category_id, name: version.category_name}] : []);
}

function IndexTitle({title, tags = []}: {title: string; tags?: KnowledgeVersion['tags']}) {
  return <span className="kb-index-row-main">
    <span className="kb-index-title">{title}</span>
    {!!tags.length && <span className="kb-index-tag"><TagChip tag={tags[0]} />
      {tags.length > 1 && <small aria-label={'另有 ' + (tags.length - 1) + ' 个标签'}>+{tags.length - 1}</small>}
    </span>}
  </span>;
}

export function KnowledgeWorkspace({api, identity}: {api: KnowledgeApi; identity: KnowledgeIdentity}) {
  const canWrite = identity.can_write;
  const navigation = useKnowledgeNavigation(canWrite);
  const {
    scope, issueId, reviewId, reviewHead, mode, branchId, documentId, tab, mobileDetail, navigate,
  } = navigation;
  const {
    search, revision, merges, reviewMatches, branches, list, drafts, category, setCategory, query,
    setQuery, doc, loadingDoc, loadingMerges, reviewError, error, refresh,
  } = useKnowledgeData(api, canWrite, navigation);
  const workspace = useRef<HTMLElement>(null);
  const detailScroll = useRef<HTMLDivElement>(null);
  const [newCategory, setNewCategory] = useState(false);
  const [notice, setNotice] = useState('');
  const [newBranch, setNewBranch] = useState(false);
  const [editor, setEditor] = useState<{document?: KnowledgeVersion} | null>(null);
  const [categoryPanel, setCategoryPanel] = useState<{tag: KnowledgeCategory; branchId: string} | null>(null);
  const [tagPicker, setTagPicker] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [tagError, setTagError] = useState('');
  const tagInspection = useRef<symbol | null>(null);
  const [tagBallotCount, setTagBallotCount] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [help, setHelp] = useState(false);
  const [now, setNow] = useState(Date.now);
  const branch = branches.find(b => b.id === branchId);
  const review = merges.find(merge => merge.id === reviewId);
  const simple = mode === 'simple';
  const all = canWrite && simple && scope === 'all';
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

  useEffect(() => {
    if (review && review.branch_id !== branchId) navigate({branchId: review.branch_id}, 'replace');
  }, [review, branchId, navigate]);

  const activeReviews = merges.filter(merge =>
    merge.state === 'open' && ((!merge.expired && (!votingClosed(merge, now) || merge.approval_count >= 3)) ||
      (merge.author_id === identity.id && (merge.changes?.length ?? 0) > 1)))
    .sort((a, b) => (a.expires_at ?? '').localeCompare(b.expires_at ?? '') || a.id.localeCompare(b.id));
  const term = search.toLowerCase();
  const visibleReviews = reviewMatches ? activeReviews.filter(merge => {
    const changes = merge.changes ?? [];
    if (category && !changes.some(change => change.tags.some(tag => tag.id === category))) return false;
    if (!term) return true;
    // A site build may reach readers before the knowledge worker's search projection.
    return merge.matches_search ?? [merge.title, merge.reason, ...changes.flatMap(change => [change.title, ...change.tags.map(tag => tag.name)])]
      .some(value => value.toLowerCase().includes(term));
  }) : [];
  const tags = new Map(list.categories.map(tag => [tag.id, {tag, branchId: tag.branch_id ?? (scope === 'branch' ? branchId : 'main')}]));
  if (all) {
    for (const tag of drafts.categories) {
      if (!tags.has(tag.id)) {
        const source = tag.branch_id ?? drafts.items.find(item => tagsFor(item).some(entry => entry.id === tag.id))?.branch_id;
        tags.set(tag.id, {tag, branchId: source ?? 'main'});
      }
    }
    for (const merge of activeReviews) {
      for (const change of merge.changes ?? []) {
        for (const tag of change.tags) {
          if (!tags.has(tag.id)) tags.set(tag.id, {
            tag: {...tag, definition: '', count: 0, version: 0, updated_at: merge.updated_at}, branchId: merge.branch_id,
          });
        }
      }
    }
  }
  const listLoading = list.loading || (all && (drafts.loading || loadingMerges || !reviewMatches && !reviewError));
  const listError = list.error || (all && (drafts.error || reviewError));
  const firstDraft = all ? drafts.items[0] : undefined;
  const firstReview = all && !firstDraft ? visibleReviews[0] : undefined;
  const firstDocument = firstDraft ?? (!firstReview ? list.items[0] : undefined);

  useEffect(() => {
    if (tab !== 'content' || documentId || reviewId || listLoading) return;
    const desktop = window.matchMedia('(min-width: 701px)');
    function openFirst() {
      if (simple && !desktop.matches) return;
      if (firstReview) navigate({reviewId: firstReview.id, reviewHead: firstReview.head_id, branchId: firstReview.branch_id}, 'replace');
      else if (firstDocument) navigate({documentId: firstDocument.document_id, branchId: firstDocument.branch_id ?? branchId}, 'replace');
    }
    openFirst();
    desktop.addEventListener('change', openFirst);
    return () => desktop.removeEventListener('change', openFirst);
  }, [simple, tab, documentId, reviewId, listLoading, branchId, firstReview, firstDocument, navigate]);

  function selectTag(id: string) {
    if (id === category) return;
    setCategory(id);
    navigate({...noSelection, branchId: scope === 'branch' ? branchId : 'main', mobileDetail: false}, 'replace');
    setNotice('');
  }

  function selectBranch(id: string) {
    const retain = id === branchId && !reviewId;
    navigate({scope: 'branch', branchId: id, ...(retain ? {} : noSelection)});
    setCategory('');
    setCategoryPanel(null);
    setNotice('');
  }

  function selectScope(value: Scope) {
    const retain = simple && branchId === 'main' && documentId;
    navigate({...noSelection, scope: value, branchId: 'main', tab: 'content', mobileDetail: false, documentId: retain || null});
    if (!simple) setCategory('');
    setCategoryPanel(null);
    setNotice('');
  }

  function selectReview(id: string, head: string, bid: string) {
    navigate({...noSelection, mode: 'simple', scope: 'all', reviewId: id, reviewHead: head, branchId: bid, tab: 'content', mobileDetail: true});
    setNotice('');
  }

  function openTab(value: Tab) {
    navigate({mode: 'git', scope: simple ? 'branch' : scope, tab: value, mobileDetail: true});
  }

  function openIssue(id: string) {
    navigate({mode: 'git', scope: simple ? 'branch' : scope, tab: 'issues', issueId: id, reviewId: null, reviewHead: null, mobileDetail: true});
    setCategoryPanel(null);
    refresh();
  }

  function collaborateOnReview() {
    if (!review) return;
    navigate({...noSelection, mode: 'git', scope: 'branch', branchId: review.branch_id, tab: 'branches', mobileDetail: true});
    setCategory('');
    setCategoryPanel(null);
  }

  function changeMode() {
    if (simple) {
      if (review) collaborateOnReview();
      else openTab(documentId ? 'content' : 'branches');
      return;
    }
    const candidate = activeReviews.find(merge => merge.branch_id === branchId);
    if (candidate) selectReview(candidate.id, candidate.head_id, candidate.branch_id);
    else navigate({mode: 'simple', scope: 'all', tab: 'content', issueId: null, mobileDetail: !!documentId});
  }

  function selectDocument(id: string, bid: string, nextScope = scope) {
    navigate({...noSelection, scope: nextScope, documentId: id, branchId: bid, tab: 'content', mobileDetail: true});
    setNotice('');
  }

  function closeTagPicker() {
    tagInspection.current = null;
    setTagPicker(false);
  }

  async function inspectTag(id: string) {
    const tagged = tags.get(id);
    if (!tagged) return;
    const request = Symbol();
    tagInspection.current = request;
    setTagError('');
    try {
      let tag = tagged.tag;
      if (!tag.version) {
        const result = await api.read<{categories: KnowledgeCategory[]}>('/categories?' + new URLSearchParams({branch_id: tagged.branchId}));
        const found = result.categories.find(item => item.id === id);
        if (!found) throw new Error('这个标签已不可用。');
        tag = found;
      }
      if (tagInspection.current !== request) return;
      closeTagPicker();
      setCategoryPanel({tag, branchId: tagged.branchId});
    } catch (error) {
      if (tagInspection.current === request) setTagError((error as Error).message);
    }
  }

  function renderDocuments(items: KnowledgeVersion[], fallbackBranch: string) {
    return items.map(item => {
      const bid = item.branch_id ?? fallbackBranch;
      const selected = item.document_id === documentId && bid === branchId;
      const excerpt = simple && bid === 'main'
        ? item.body.split('\n').find(line => line.trim() && !/^#{1,3}\s/.test(line.trim())) || item.body.replace(/^#+\s*/, '').trim()
        : '';
      return <button type="button" key={bid + ':' + item.document_id} aria-current={selected || undefined}
        className={'kb-entry' + (selected ? ' selected' : '')} onClick={() => selectDocument(item.document_id, bid)}>
        {simple ? <>
          <IndexTitle title={item.title} tags={tagsFor(item)} />
          {excerpt ? <span className="kb-index-excerpt">{excerpt}</span>
            : <span className="kb-index-meta"><Byline name={item.author_name} at={item.created_at} /></span>}
        </> : <div>
          <h2>{item.title}</h2>
          <p>{item.body.replace(/^#+\s*/gm, '').replace(/\n/g, ' ')}</p>
        </div>}
      </button>;
    });
  }
  const openHelp = () => setHelp(value => !value);
  const modeLabel = simple ? '版本协作' : '返回普通视图';
  const documentTags = doc ? tagsFor(doc) : [];
  const documentState = branchId === 'main' ? '已入库' : branch?.visibility === 'private' ? '我的草稿' : branch?.state === 'merged' ? '已合入的分支版本' : '分支中的修改';
  const noDocuments = !list.items.length && (!all || !drafts.items.length && !visibleReviews.length && !tagBallotCount);
  const editorBranch = simple && !editor?.document ? branches.find(candidate => candidate.id === 'main') : branch;
  const shareDocument = doc && (branchId === 'main' || branch?.visibility === 'members') && <ShareLink path={'/knowledge?' + new URLSearchParams({
    document: doc.document_id,
    ...(branchId !== 'main' ? {branch: branchId, mode: 'git'} : {}),
  })} label="分享文档" />;

  return <main ref={workspace} className={'kb-workspace ' + (simple ? 'kb-index ' : '') + (mobileDetail ? 'kb-detail-visible ' : '') + (help ? 'kb-help-active' : '')}>
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
          {simple ? <>
            {canWrite && <button data-kb-help="scope-all" className={all ? 'active' : ''} aria-pressed={all} onClick={() => {if (!all) selectScope('all');}}>全部</button>}
            <button data-kb-help="scope-main" className={!all ? 'active' : ''} aria-pressed={!all} onClick={() => {if (all) selectScope('main');}}>已入库</button>
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
          <input type="search" aria-label="搜索知识库" placeholder="搜索标题或正文" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} />
        </div>
        <button className="button quiet kb-tag-filter" aria-label="标签筛选" aria-haspopup="dialog" data-kb-help="tags" onClick={() => {setTagQuery(''); setTagError(''); setTagPicker(true);}}>
          {tags.get(category)?.tag.name ?? '标签筛选'}
        </button>
        {category && <button className="button quiet kb-clear-tag" aria-label="清除标签筛选" onClick={() => selectTag('')}>×</button>}
      </div>
      <div className="kb-entries">
        {listError && <p className="kb-list-message form-error" role="alert">{listError} <button className="text-button" onClick={refresh}>重试</button></p>}
        {listLoading && <p className="kb-list-message" role="status">正在读取…</p>}
        {all && <>
          {!!drafts.items.length && <section className="kb-index-group" aria-label="我的草稿">
            <h2>我的草稿</h2>
            {renderDocuments(drafts.items, 'main')}
            {drafts.next !== null && <button className="button quiet kb-index-more" disabled={drafts.loadingMore} onClick={drafts.more}>加载更多草稿</button>}
          </section>}
          {!!visibleReviews.length && <section className="kb-index-group" aria-label="待认可">
            <h2>待认可</h2>
            {visibleReviews.map(merge => {
              const selected = merge.id === reviewId;
              const deadline = reviewDeadline(merge, now);
              return <button type="button" key={merge.id} aria-current={selected || undefined}
                className={'kb-entry kb-review-entry' + (selected ? ' selected' : '')}
                onClick={() => selectReview(merge.id, merge.head_id, merge.branch_id)}>
                <IndexTitle title={merge.title} tags={merge.changes?.[0]?.tags} />
                <span className="kb-index-meta">
                  <span>{merge.author_name}</span>
                  {deadline && <time dateTime={merge.expires_at!}>{deadline}</time>}
                  <span>{merge.approval_count}/3{merge.approved_by_me ? ' · 已认可' : ''}</span>
                </span>
              </button>;
            })}
          </section>}
          <KnowledgeTagProposals api={api} revision={revision} onChanged={refresh} canWrite={canWrite} search={search} category={category} onCount={setTagBallotCount} />
        </>}
        {all ? !!list.items.length && <section className="kb-index-group" aria-label="已入库">
          <h2>已入库</h2>
          {renderDocuments(list.items, 'main')}
        </section> : renderDocuments(list.items, scope === 'branch' ? branchId : 'main')}
        {!listLoading && !listError && noDocuments && <p className="kb-list-message">
          {search || category ? '没有符合条件的文档。' : all ? '还没有文档。' : visibleScope === 'drafts' ? '还没有草稿。' : visibleScope === 'public' ? '暂无公开候审的文档。' : '还没有已入库文档。'}
        </p>}
        {list.next !== null && <button className="button quiet kb-index-more" disabled={list.loadingMore} onClick={list.more}>{all ? '加载更多已入库文档' : '加载更多文档'}</button>}
      </div>
    </aside>

    <section className="kb-detail-pane" aria-label="知识库内容">
      <div ref={detailScroll} className="kb-detail-scroll">
        <header className="kb-detail-toolbar">
          <button className="kb-mobile-back text-button" onClick={() => navigate({mobileDetail: false}, 'replace')}>← 文档</button>
          {canWrite && <div className="kb-view-switch"><button className="button quiet" onClick={changeMode}>{modeLabel}</button></div>}
          {!simple && shareDocument}
          <KnowledgeHelpButton active={help} onClick={openHelp} />
        </header>
        {mode === 'git' && <nav className="kb-content-tabs" aria-label="知识库页面">
          {versionTabs.filter(([id]) => canWrite || id === 'content' || id === 'history').map(([id, title]) =>
            <button data-kb-help={'tab-' + id} key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => openTab(id)}>{title}</button>)}
        </nav>}
        {error && <div className="kb-notice error" role="alert">{error}<button className="text-button" onClick={refresh}>重试</button></div>}
        {notice && <div className="kb-notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
        {tab === 'content' && (simple && reviewId ? review ?
          <KnowledgeReviewDetail key={review.id + review.head_id} api={api} merge={review} identity={identity} revision={revision}
            now={now} requestedHead={reviewHead} onChanged={refresh} onCollaborate={collaborateOnReview}
            onOpenCurrent={() => selectReview(review.id, review.head_id, review.branch_id)}
            onIssue={openIssue} onReadDocument={id => selectDocument(id, 'main')}
            onResubmitted={(id, head, bid) => {selectReview(id, head, bid); refresh();}} /> :
          <div className="kb-empty"><p role="status">{loadingMerges ? '正在读取审核…' : reviewError || '无法打开该审核，可能已关闭或不可访问。'}</p>
            {reviewError && <button className="text-button" onClick={refresh}>重试</button>}
          </div> :
          doc ? <article className="kb-article">
            {simple ? <header className="kb-reading-header">
              <div className="kb-article-title">
                <h1>{doc.title}</h1><span className={'kb-reading-status' + (branchId === 'main' ? ' is-adopted' : '')}>{documentState}</span>
              </div>
              <div className="kb-reading-details">
                <p className="kb-reading-byline">
                  <KnowledgeAvatar id={doc.author_id} name={doc.author_name} identity={identity} size="tiny" />
                  <Byline name={doc.author_name} at={doc.created_at} />
                </p>
                {!!documentTags.length && <div className="kb-document-tags" aria-label="文档标签">
                  {documentTags.map(tag => <TagChip key={tag.id} tag={tag} />)}
                </div>}
                {(shareDocument || canWrite && editable) && <div className="kb-reading-actions">
                  {shareDocument}
                  {canWrite && editable && <button data-kb-help="edit" className="button quiet" onClick={() => setEditor({document: doc})}>
                    <Icon name="edit" size={16} />{branch?.visibility === 'private' ? '编辑草稿' : '建议修改'}
                  </button>}
                </div>}
              </div>
            </header> : <>
              <div className="kb-article-title"><h1>{doc.title}</h1></div>
              <p className="kb-article-meta">{documentState}{branch && ' · ' + branch.name}<span>{doc.author_name}</span></p>
            </>}
            <KnowledgeDocumentBody key={branchId + doc.id} api={api} document={doc} branchId={branchId} writable={canWrite} identity={identity} onIssue={openIssue}
              footer={!simple && <div className="kb-document-actions">
                <div>
                  {canWrite && <button data-kb-help="issues" className="text-button" onClick={() => openTab('issues')}>议题</button>}
                  <button data-kb-help="history" className="text-button" onClick={() => openTab('history')}>历史版本</button>
                </div>
                {canWrite && editable && <button data-kb-help="edit" className="button" onClick={() => setEditor({document: doc})}>
                  <Icon name="edit" size={18} />在分支中修改
                </button>}
                {canWrite && branchId !== 'main' && editable && <button data-kb-help="remove" className="text-button" onClick={() => setRemoving(true)}>移除文档</button>}
              </div>} />
          </article> : <div className="kb-empty">
            {loadingDoc ? <p role="status">正在读取文档…</p> : !error && <p>选择一篇文档开始阅读。</p>}
          </div>)}
        {tab === 'issues' && <KnowledgeIssues api={api} writable={canWrite} revision={revision} selectedId={issueId} onChanged={refresh} />}
        {tab === 'branches' && <KnowledgeBranches api={api} actorId={identity.id} branches={branches} branchId={branchId} writable={canWrite}
          revision={revision} now={now} onBranch={selectBranch} onChanged={refresh} onNew={() => setNewBranch(true)} onIssue={() => openTab('issues')}
          onReview={merge => selectReview(merge.id, merge.head_id, merge.branch_id)} />}
        {tab === 'history' && <KnowledgeHistory key={branchId + revision} api={api} branchId={branchId} />}
      </div>
      {tab === 'content' && !reviewId && doc && branch && canWrite && <KnowledgeReviewBar key={branchId + doc.id} api={api} branch={branch} document={doc}
        actorId={identity.id} now={now} merge={merges.find(m => m.branch_id === branchId && m.state === 'open')}
        onSubmitted={(bid, id, head) => {
          if (simple) selectReview(id, head, bid);
          else selectDocument(doc.document_id, bid, 'public');
          refresh();
        }}
        onMerged={() => {
          selectDocument(doc.document_id, 'main', simple ? 'all' : 'main');
          refresh();
        }}
        onChanged={refresh} onBranches={() => openTab('branches')} />}
    </section>

    {help && <KnowledgeHelp root={workspace} writable={canWrite} close={() => setHelp(false)} />}
    {newBranch && <KnowledgeBranchForm api={api} close={() => setNewBranch(false)} done={id => {
      setNewBranch(false);
      selectBranch(id);
      refresh();
    }} />}
    {editor && editorBranch && <KnowledgeEditor api={api} identity={identity} branch={editorBranch} document={editor.document}
      categories={[...tags.values()].map(({tag}) => tag)} simple={simple} close={() => setEditor(null)} done={(id, bid) => {
        setEditor(null);
        selectDocument(id, bid, simple ? 'all' : 'branch');
        if (simple) setNotice('草稿已保存，可在底部提交到审核。');
        refresh();
      }} />}
    {tagPicker && <Modal title="标签筛选" onClose={closeTagPicker}>
      <div className="tag-catalog-dialog kb-tag-picker">
        <TagCatalog query={tagQuery} onQuery={setTagQuery}
          items={[...tags.values()].map(({tag}) => tag).filter(tag => (tag.name + ' ' + tag.definition).normalize('NFKC').toLocaleLowerCase().includes(tagQuery.normalize('NFKC').trim().toLocaleLowerCase()))
            .map(tag => ({...tag, description: tag.definition || '暂无标签解释'}))}
          loading={listLoading} selectedIds={category ? [category] : []} searchPlaceholder="搜索标签名称或解释"
          onSelect={id => {selectTag(id); closeTagPicker();}} onInspect={inspectTag}
          feedback={tagError && <p role="alert" className="form-error">{tagError}</p>}
          onCreate={canWrite ? () => {closeTagPicker(); setNewCategory(true);} : undefined} createLabel="＋ 新建标签" />
      </div>
    </Modal>}
    {newCategory && <KnowledgeCategoryEditor api={api} branchId={simple ? 'main' : branchId} startCreating initialName={tagQuery} close={() => setNewCategory(false)} done={tag => {
      setNewCategory(false);
      setCategoryPanel({tag, branchId: simple ? 'main' : branchId});
      refresh();
    }} />}
    {categoryPanel && <KnowledgeCategoryDrawer key={categoryPanel.tag.id} api={api} category={categoryPanel.tag} branchId={categoryPanel.branchId}
      identity={identity} close={() => setCategoryPanel(null)}
      onChanged={tag => {setCategoryPanel({...categoryPanel, tag}); refresh();}} onIssue={openIssue} />}
    {removing && doc && branch && <RemoveDocument api={api} branch={branch} document={doc} close={() => setRemoving(false)} done={() => {
      setRemoving(false);
      navigate({documentId: null}, 'replace');
      refresh();
    }} />}
  </main>;
}
