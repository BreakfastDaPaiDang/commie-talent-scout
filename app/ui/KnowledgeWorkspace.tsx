import { useKnowledgeNavigation, type Tab, type Scope } from './knowledge/navigation';
import { useKnowledgeData } from './knowledge/data';
import { useRef, useState } from 'react';
import { Icon } from "./icons";
import { ShareLink } from "./ShareLink";
import { KnowledgeDocumentBody } from "./KnowledgeComments";
import { KnowledgeCategoryDrawer, KnowledgeCategoryEditor } from "./KnowledgeCategories";
import { KnowledgeReviewBar } from "./KnowledgeReview";
import { KnowledgeHelp, KnowledgeHelpButton } from "./KnowledgeHelp";
import { KnowledgeBranches, KnowledgeBranchForm, KnowledgeIssues, KnowledgeHistory } from "./KnowledgeCollaboration";
import type { KnowledgeApi, KnowledgeCategory, KnowledgeIdentity, KnowledgeVersion } from "../shared/knowledge";
import { TagChip } from "./TagCatalog";
import "./knowledge.css";
import { KnowledgeEditor, RemoveDocument } from './knowledge/KnowledgeEditor';
export function KnowledgeWorkspace({
  api,
  identity
}: {
  api: KnowledgeApi;
  identity: KnowledgeIdentity;
}) {
  const navigation = useKnowledgeNavigation();
  const {
    scope,
    setScope,
    issueId,
    setIssueId,
    mode,
    setMode,
    branchId,
    setBranchId,
    documentId,
    setDocumentId,
    tab,
    setTab,
    mobileDetail,
    setMobileDetail
  } = navigation;
  const {
    search,
    revision,
    merges,
    branches,
    items,
    setItems,
    categories,
    category,
    setCategory,
    query,
    setQuery,
    doc,
    setDoc,
    loading,
    error,
    setError,
    refresh,
    more,
    next
  } = useKnowledgeData(api, identity.can_write, navigation);
  const workspace = useRef<HTMLElement>(null);
  const [newCategory, setNewCategory] = useState(false);
  const [notice, setNotice] = useState(''),
    [newBranch, setNewBranch] = useState(false),
    [editor, setEditor] = useState<{
      document?: KnowledgeVersion;
    } | null>(null),
    [categoryPanel, setCategoryPanel] = useState<KnowledgeCategory | null>(null),
    [removing, setRemoving] = useState(false),
    [help, setHelp] = useState(false);
  const branch = branches.find(b => b.id === branchId),
    canWrite = identity.can_write,
    press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    pressOpened = useRef(false);
  const openHelp = () => setHelp(value => !value);
  const visibleScope = scope === 'branch' ? branchId === 'main' ? 'main' : branch?.visibility === 'private' ? 'drafts' : 'public' : scope;
  function selectBranch(id: string) {
    setScope('branch');
    if (id === branchId) return;
    setBranchId(id);
    setDocumentId(null);
    setItems([]);
    setDoc(null);
    setCategory('');
    setCategoryPanel(null);
    setError('');
  }
  function changeMode(value: 'simple' | 'git') {
    setMode(value);
    setTab('content');
  }
  function selectScope(value: Scope) {
    setScope(value);
    setBranchId('main');
    setDocumentId(null);
    setDoc(null);
    setItems([]);
    setCategory('');
    setCategoryPanel(null);
    setTab('content');
    setMobileDetail(false);
  }
  function openIssue(id: string) {
    setIssueId(id);
    setMode('git');
    setTab('issues');
    setMobileDetail(true);
    setCategoryPanel(null);
    refresh();
  }
  function openTab(value: Tab) {
    setTab(value);
    setMobileDetail(true);
    if (value === 'branches') setMode('git');
  }
  return <main ref={workspace} className={'kb-workspace ' + (mobileDetail ? 'kb-detail-visible ' : '') + (help ? 'kb-help-active' : '')}>
 <aside className="kb-list-pane" aria-label="知识库条目"><header className="kb-list-head"><h1>知识库</h1><div className="kb-search"><Icon name="search" size={18} /><input type="search" aria-label="搜索知识条目" placeholder="搜索条目、方法、案例" value={query} onChange={e => setQuery(e.target.value)} maxLength={100} /></div>{canWrite && <button data-kb-help="new-entry" className="button primary" onClick={() => setEditor({})}>＋ 新条目</button>}<KnowledgeHelpButton list active={help} onClick={openHelp} /></header>
 {mode === 'git' && <section className="kb-branch-box" aria-label="当前分支"><div><span aria-hidden="true">⑂</span><select aria-label="当前分支" value={branchId} onChange={e => selectBranch(e.target.value)}>{branches.map(b => <option key={b.id} value={b.id}>{b.id === 'main' ? '主分支' : b.name}{b.id !== 'main' && b.visibility === 'private' ? ' · 私人' : ''}</option>)}</select></div></section>}
 <nav className="kb-library-views" aria-label="知识库范围"><button data-kb-help="scope-main" className={visibleScope === 'main' ? 'active' : ''} onClick={() => selectScope('main')}>主要</button>{canWrite && <><button data-kb-help="scope-public" className={visibleScope === 'public' ? 'active' : ''} onClick={() => selectScope('public')}>公开</button><button data-kb-help="scope-drafts" className={visibleScope === 'drafts' ? 'active' : ''} onClick={() => selectScope('drafts')}>草稿</button></>}</nav>
 <nav className="kb-categories" aria-label="文档分类"><button className={!category ? 'active' : ''} onClick={() => setCategory('')}>全部</button>{categories.map(c => <button key={c.id} className={'kb-category-tag' + (category === c.id ? ' active' : '')} aria-label={'分类：' + c.name} title="右键查看定义与留言" onClick={() => {
          if (!pressOpened.current) setCategory(c.id);
          pressOpened.current = false;
        }} onContextMenu={e => {
          e.preventDefault();
          setCategoryPanel(c);
        }} onKeyDown={e => {
          if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') {
            e.preventDefault();
            setCategoryPanel(c);
          }
        }} onPointerDown={e => {
          pressOpened.current = false;
          if (e.pointerType === 'touch') press.current = setTimeout(() => {
            pressOpened.current = true;
            setCategoryPanel(c);
          }, 550);
        }} onPointerMove={() => clearTimeout(press.current)} onPointerUp={() => clearTimeout(press.current)} onPointerCancel={() => clearTimeout(press.current)}><TagChip tag={c} /></button>)}{canWrite && <button className="kb-category-add button primary" aria-label="添加分类" title="添加分类" onClick={() => setNewCategory(true)}>＋</button>}</nav>
 {loading && <p className="kb-list-message" role="status">正在读取条目…</p>}<div className="kb-entries">{items.map(item => <button key={(item.branch_id ?? branchId) + item.document_id} className={'kb-entry ' + (item.document_id === documentId && (!item.branch_id || item.branch_id === branchId) ? 'selected' : '')} onClick={() => {
          setDocumentId(item.document_id);
          if (item.branch_id) setBranchId(item.branch_id);
          setTab('content');
          setMobileDetail(true);
          setError('');
        }}><span className="kb-entry-kind">{item.kind}</span><div><h2>{item.title}</h2><p>{item.body.replace(/^#+\s*/gm, '').replace(/\n/g, ' ')}</p></div></button>)}{!loading && !items.length && <p className="kb-list-message">{search ? '没有匹配的条目' : visibleScope === 'drafts' ? '还没有草稿。' : visibleScope === 'public' ? '暂无公开候审的文档。' : '主要知识库还没有文档，可先提出第一篇条目。'}</p>}{next !== null && <button className="button quiet" onClick={more}>加载更多条目</button>}</div></aside>
 <section className="kb-detail-pane" aria-label="知识库内容"><div className="kb-detail-scroll"><header className="kb-detail-toolbar"><button className="kb-mobile-back text-button" onClick={() => setMobileDetail(false)}>← 条目</button>{mode === 'simple' && <span className="kb-breadcrumb">{doc?.category_name ?? '知识条目'}{doc ? ' / ' + doc.kind : ''}</span>}<div className="kb-view-switch" aria-label="知识库视图"><button aria-pressed={mode === 'simple'} className={mode === 'simple' ? 'active' : ''} onClick={() => changeMode('simple')}>简</button><button aria-pressed={mode === 'git'} className={mode === 'git' ? 'active' : ''} onClick={() => changeMode('git')}>繁</button></div>{doc && <ShareLink path={'/knowledge?' + new URLSearchParams({
            document: doc.document_id,
            ...(branchId !== 'main' ? {
              branch: branchId,
              mode: 'git'
            } : {})
          })} label="分享文档" />}<KnowledgeHelpButton active={help} onClick={openHelp} /></header>
 {mode === 'git' && <nav className="kb-content-tabs" aria-label="知识库页面">{([['content', '内容'], ['issues', '议题'], ['branches', '分支'], ['history', '历史']] as [Tab, string][]).filter(([id]) => canWrite || id === 'content' || id === 'history').map(([id, title]) => <button data-kb-help={'tab-' + id} key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => openTab(id)}>{title}</button>)}</nav>}
 {error && <div className="kb-notice error" role="alert">{error}<button className="text-button" onClick={refresh}>重试</button></div>}{notice && <div className="kb-notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
 {tab === 'content' ? doc ? <article className="kb-article"><div className="kb-article-title"><h1>{doc.title}</h1></div><p className="kb-article-meta">{branchId === 'main' ? '当前共识' : branch?.visibility === 'private' ? '私人草稿' : branch?.state === 'merged' ? '已合入的分支版本' : '分支中的修改'}{mode === 'git' ? ' · ' + (branch?.name ?? '') : ''}<span>{doc.author_name}</span></p><KnowledgeDocumentBody key={branchId + doc.id} api={api} document={doc} branchId={branchId} writable={canWrite} identity={identity} onIssue={openIssue} footer={<div className="kb-document-actions"><div>{canWrite && <button data-kb-help="issues" className="text-button" onClick={() => openTab('issues')}>议题</button>}<button data-kb-help="history" className="text-button" onClick={() => openTab('history')}>历史版本</button></div>{canWrite && branch?.state === 'open' && <button data-kb-help="edit" className="button" onClick={() => setEditor({
              document: doc
            })}><Icon name="edit" size={18} />{mode === 'simple' ? '建议修改' : '在分支中修改'}</button>}{canWrite && branchId !== 'main' && branch?.state === 'open' && <button data-kb-help="remove" className="text-button" onClick={() => setRemoving(true)}>移除文档</button>}</div>} /></article> : <div className="kb-empty"><h2>把经验写下来，一起形成共识。</h2><p>选择一篇文档开始阅读，或提出新的条目。</p>{canWrite && <button data-kb-help="new-entry" className="button primary" onClick={() => setEditor({})}>＋ 新条目</button>}{mode === 'simple' && canWrite && <button data-kb-help="issues" className="text-button" onClick={() => openTab('issues')}>查看议题</button>}</div> : tab === 'issues' ? <KnowledgeIssues api={api} writable={canWrite} revision={revision} selectedId={issueId} onChanged={refresh} /> : tab === 'branches' ? <KnowledgeBranches api={api} actorId={identity.id} branches={branches} branchId={branchId} writable={canWrite} revision={revision} onBranch={selectBranch} onChanged={refresh} onNew={() => setNewBranch(true)} onIssue={() => openTab('issues')} /> : <KnowledgeHistory key={branchId + revision} api={api} branchId={branchId} />}
 </div>{tab === 'content' && doc && branch && canWrite && <KnowledgeReviewBar key={branchId + doc.id} api={api} branch={branch} document={doc} merge={merges.find(m => m.branch_id === branchId && m.state === 'open')} onSubmitted={id => {
        setBranchId(id);
        setScope('public');
        refresh();
      }} onMerged={() => {
        setBranchId('main');
        setScope('main');
        refresh();
      }} onChanged={refresh} onBranches={() => openTab('branches')} />}</section>
 {help && <KnowledgeHelp root={workspace} writable={canWrite} close={() => setHelp(false)} />}
 {newBranch && <KnowledgeBranchForm api={api} close={() => setNewBranch(false)} done={id => {
      setNewBranch(false);
      selectBranch(id);
      setMode('git');
      refresh();
    }} />}
 {editor && branch && <KnowledgeEditor api={api} identity={identity} branch={branch} document={editor.document} categories={categories} simple={mode === 'simple'} close={() => setEditor(null)} done={(id, bid) => {
      setEditor(null);
      selectBranch(bid);
      setDocumentId(id);
      setScope(branch?.id === bid && branch.visibility === 'members' ? 'branch' : 'drafts');
      setTab('content');
      setMobileDetail(true);
      setNotice('草稿已保存，可在底部提交到审核。');
      refresh();
    }} />}
 {newCategory && <KnowledgeCategoryEditor api={api} branchId={branchId} close={() => setNewCategory(false)} done={c => {
      setNewCategory(false);
      setCategoryPanel(c);
      refresh();
    }} />}
 {categoryPanel && <KnowledgeCategoryDrawer key={categoryPanel.id} api={api} category={categoryPanel} branchId={branchId} identity={identity} close={() => setCategoryPanel(null)} onChanged={c => {
      setCategoryPanel(c);
      refresh();
    }} onIssue={openIssue} />}
 {removing && doc && branch && <RemoveDocument api={api} branch={branch} document={doc} close={() => setRemoving(false)} done={() => {
      setRemoving(false);
      setDocumentId(null);
      refresh();
    }} />}
 </main>;
}
