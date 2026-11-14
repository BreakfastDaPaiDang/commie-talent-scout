import { useArchiveNavigation } from './archives/useArchiveNavigation';
import { useArchiveList } from './archives/useArchiveList';
import { useArchiveDirectory } from './archives/useArchiveDirectory';
import { useArchiveDrafts } from './archives/useArchiveDrafts';
import { useArchiveEditor } from './archives/useArchiveEditor';
import { ClosedHistoryFilter } from "../ui/Workspace";
import { TagFilter } from "./TagMaintenance";
import { MemberPicker as DirectoryPicker } from "../ui/MemberPicker";
import { ArchiveHead, ArchiveRow, ScopeToolbar, TabList, WorkspaceFrame } from "../ui/Workspace";
import { Highlight } from "./Reading";
import { archiveStateLabel, statesFor, memberBasicStates, archiveDisplayStatus } from "../rules/archive-states";
import { AvatarEditor, avatarUrl } from "./AvatarEditor";
import { useRef, useState } from 'react';
import { api, type Member } from "./api";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";
import { PageError } from "./ConnectionPages";
import type { Archive } from "../shared/archives";
import { ArchiveStateForm } from "./ArchiveStateForm";
import { isWorkState } from "../rules/archive-states";
import "./archives.css";
import { TagsSection, TagSummary } from "./TagsSection";
import { type Kind, type Preference, type ArchivePageProps } from './archives/types';
import { defaults } from './archives/preferences';
import { date } from './archives/presentation';
import { ArchiveDeletionDialog, ArchiveForm } from './archives/ArchiveForms';
import { ArchiveDetail } from './archives/ArchiveDetail';
export function ArchiveTrashPage({
  actor
}: {
  actor: Member;
}) {
  const [type, setType] = useState<Kind>('person');
  return <ArchivesPage key={type} actor={actor} type={type} trash onTypeChange={next => {
    history.replaceState(null, '', location.pathname);
    setType(next);
  }} />;
}
export function ArchivesPage({
  actor,
  type,
  personScope = 'all',
  linked,
  detailOnly = false,
  onNextUnread,
  onClose,
  trash = false,
  onTypeChange,
  pageLabel,
  initialStatus = '',
  createStatus
}: ArchivePageProps) {
  const {
    pref,
    setPref,
    query,
    setQuery,
    notice,
    setNotice,
    selected,
    setSelected,
    expanded,
    setExpanded,
    focus,
    setFocus,
    choose,
    openTaskArchive
  } = useArchiveNavigation({
    actor,
    type,
    trash,
    pageLabel,
    detailOnly,
    initialStatus,
    personScope,
    linked
  });
  const {
    revision,
    setError,
    items,
    cursor,
    loading,
    error,
    counts,
    load,
    refresh
  } = useArchiveList({
    type,
    personScope,
    trash,
    detailOnly,
    pref
  });
  const {
    directory,
    directoryError,
    directoryRetry,
    setDirectoryRetry
  } = useArchiveDirectory();
  const {
    draftIds
  } = useArchiveDrafts();
  const {
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
  } = useArchiveEditor({
    detailOnly,
    trash,
    choose,
    setNotice,
    refresh
  });
  const [filtersOpen, setFiltersOpen] = useState(false),
    searchRef = useRef<HTMLInputElement>(null);
  const label = pageLabel ?? (type === 'person' ? '人物' : '组织');
  const statusLocked = !!initialStatus,
    activeFilters = !!(!statusLocked && pref.status || pref.member_id || personScope !== 'members' && (pref.closed !== 'all' || !trash && pref.closed_history !== 'all') || pref.tag_ids.length);
  return <><WorkspaceFrame selected={!!pref.selected} expanded={expanded} detailOnly={detailOnly} listFooter={!trash && personScope !== 'members' ? <ClosedHistoryFilter value={pref.closed_history} onChange={closed_history => setPref(p => ({
      ...p,
      closed_history
    }))} /> : undefined} list={<>
  <ArchiveHead label={trash ? '已删除档案' : label} count={String(items.length).padStart(2, '0') + (cursor ? '＋' : '')} query={query} onQuery={setQuery} onCreate={trash ? undefined : () => {
        setEditTab('profile');
        setDialog('create');
      }} searchRef={searchRef} />
  <ScopeToolbar resetLabel="重置筛选" scopeItems={trash ? [['person', '人物'], ['org', '组织']] : undefined} counts={trash ? undefined : counts} scope={trash ? type : pref.scope} onScope={scope => trash ? onTypeChange?.(scope as Kind) : setPref(p => ({
        ...p,
        scope: scope as Preference['scope']
      }))} filtersOpen={filtersOpen} onFilters={() => setFiltersOpen(v => !v)} activeFilters={activeFilters} onReset={!trash || query || activeFilters || pref.scope !== 'all' ? () => {
        setQuery('');
        setPref(p => ({
          ...defaults,
          selected: p.selected,
          status: initialStatus
        }));
      } : undefined} filters={<>
   {!statusLocked && <select aria-label={personScope === 'members' ? '筛选基本状态' : '筛选业务状态'} value={pref.status} onChange={e => setPref(p => ({
          ...p,
          status: e.target.value
        }))}><option value="">全部状态</option>{(personScope === 'members' ? [...memberBasicStates] : statesFor(type)).map(v => <option key={v} value={v}>{archiveStateLabel(v)}</option>)}</select>}
   <DirectoryPicker label="筛选绑定成员" placeholder="全部成员" multiple={false} members={directory} value={pref.member_id ? [pref.member_id] : []} onChange={ids => setPref(p => ({
          ...p,
          member_id: ids[0] ?? ''
        }))} renderAvatar={m => <Avatar name={m.name} src={avatarUrl('member', m.id, 0)} size="tiny" />} />

   <TagFilter type={type} ids={pref.tag_ids} onChange={tag_ids => setPref(p => ({
          ...p,
          tag_ids
        }))} />{personScope !== 'members' && <><select aria-label="筛选开启关闭" value={pref.closed} onChange={e => setPref(p => ({
            ...p,
            closed: e.target.value as Preference['closed']
          }))}><option value="all">全部档案</option><option value="open">开启中</option><option value="closed">已关闭</option></select></>}<PageError error={directoryError} retry={() => setDirectoryRetry(n => n + 1)} />
  </>} />
  <PageError error={error} retry={() => void load()} />{notice && !pref.selected && <p className="form-notice archive-list-message" role="status">{notice}</p>}
  <div className="entity-list">{items.map(a => <ArchiveRow key={a.id} selected={pref.selected === a.id} onClick={() => choose(a.id, a.search_match)} label={`查看${a.name}`} avatar={<Avatar name={a.name} type={a.type} src={avatarUrl('archive', a.id, a.version)} />} name={<Highlight text={a.name} query={pref.query} />} unread={!!a.unread_count} updateReminder={a.update_reminder} state={<span className={'state-badge small ' + (isWorkState(a.type, a.status) ? 'work ' : '') + (a.closed ? 'closed' : '')}>{archiveDisplayStatus(a)}</span>} status={archiveDisplayStatus(a)} binding={a.members.length ? a.members.map(m => <span className="member-chip" key={m.id}><Avatar name={m.name} src={avatarUrl('member', m.id, 0)} size="micro" />{m.name}{m.frozen && <small>已冻结</small>}</span>) : null} tags={<TagSummary tags={a.tag_summary?.tags ?? []} total={a.tag_summary?.total ?? 0} />} draft={draftIds.includes(a.id)} excerpt={a.search_match ? <><small>观察命中 · </small><Highlight text={a.search_match.excerpt} query={pref.query} /></> : a.latest_observation ?? '还没有观察记录'} footer={<><span>{a.observation_count} 条观察</span><time>{date(a.updated_at)}</time></>} />)}</div>
  {loading ? <p className="archive-list-message" role="status">正在读取档案…</p> : error ? null : !items.length ? <div className="archive-list-message"><h2>{query || activeFilters || pref.scope !== 'all' ? '没有符合条件的档案' : trash ? '没有已删除档案' : '从第一个档案开始'}</h2><p>{query ? '试试其他关键词，或清除筛选。' : trash ? '删除的档案会出现在这里。' : `把值得关注的${label}留在这里，慢慢积累观察。`}</p></div> : cursor && <button className="button archive-load" onClick={() => void load(cursor)}>加载更多档案</button>}
 </>} detail={pref.selected ? <ArchiveDetail onOpenTaskArchive={openTaskArchive} onDelete={() => selected && setDeletion(selected)} type={type} onNextUnread={onNextUnread} expanded={expanded} onExpand={detailOnly ? undefined : () => setExpanded(v => !v)} focus={focus} actor={actor} onChanged={() => refresh()} key={pref.selected} id={pref.selected} revision={revision} onLoaded={setSelected} onBack={onClose ?? (detailOnly ? undefined : () => choose(null))} onEdit={() => {
      if (selected) {
        setEditTab('profile');
        setDialog(selected);
      }
    }} onState={() => selected && setStateDialog(selected)} notice={notice} /> : <aside className="selection-rest" aria-hidden="true"><div className="rest-characters"><Avatar type={type} size="large" /></div><span>打开一个档案，继续观察。</span></aside>} />

  {dialog && <Modal title={dialog === 'create' ? `新建${label}档案` : '编辑档案'} busy={busy} onClose={() => setDialog(null)}>
   {dialog !== 'create' && <TabList id="archive-editor" value={editTab} onChange={value => {
        if (!busy) setEditTab(value);
      }} label="编辑内容" items={[{
        key: 'profile',
        label: '资料'
      }, {
        key: 'state',
        label: '状态与成员'
      }, {
        key: 'tags',
        label: '标签'
      }, {
        key: 'avatar',
        label: '头像'
      }]} />}
   <div className="archive-editor-panel" id="archive-editor-timeline" role={dialog !== 'create' ? 'tabpanel' : undefined} aria-labelledby={dialog !== 'create' ? `archive-editor-tab-${editTab}` : undefined}>
   <div hidden={dialog !== 'create' && editTab !== 'profile'}><ArchiveForm key={dialog === 'create' ? 'create' : dialog.id + dialog.version} type={type} initial={dialog === 'create' ? undefined : dialog} createStatus={dialog === 'create' ? createStatus : undefined} busy={busy} setBusy={setBusy} onSaved={saved} onReload={async () => {
            if (dialog !== 'create') await refreshEditor(dialog.id);
          }} /></div>
   {dialog !== 'create' && <div hidden={editTab !== 'state'}><ArchiveStateForm key={dialog.id + dialog.version} archive={dialog} busy={busy} setBusy={setBusy} onSaved={saved} onReload={() => refreshEditor(dialog.id)} /></div>}
   {dialog !== 'create' && editTab === 'tags' && <TagsSection archive={dialog} manage onChanged={() => {
          void refreshEditor(dialog.id).catch(e => setError(e.message));
        }} />}
   {dialog !== 'create' && editTab === 'avatar' && <AvatarEditor actorId={actor.id} subjectType="archive" id={dialog.id} version={dialog.version} name={dialog.name} kind={dialog.type} avatarId={dialog.avatar_id} onSaved={() => {
          void refreshEditor(dialog.id).catch(e => setError(e.message));
        }} />}
   </div>
   {dialog !== 'create' && actor.role === 'admin' && <div className="archive-delete-entry"><button className="text-button" disabled={busy} onClick={() => {
          setDeletion(dialog);
          setDialog(null);
        }}>删除档案</button></div>}
  </Modal>}
  {deletion && <Modal title={deletion.deleted ? '恢复档案' : '删除档案'} busy={busy} onClose={() => setDeletion(null)}><ArchiveDeletionDialog key={deletion.id + deletion.version} archive={deletion} busy={busy} setBusy={setBusy} onCancel={() => setDeletion(null)} onReload={async () => {
        const r = await api<{
          archive: Archive;
        }>('/archives/' + deletion.id);
        setDeletion(r.archive);
        refresh();
      }} onSaved={() => {
        const restored = deletion.deleted;
        setDeletion(null);
        setDialog(null);
        choose(null);
        refresh();
        setNotice(restored ? '档案已恢复' : '档案已删除，可在已删除档案中恢复');
        window.dispatchEvent(new Event('cts-reading-stale'));
      }} /></Modal>}
  {stateDialog && <Modal title={stateDialog.closed ? '重新开启档案' : '状态与成员'} busy={busy} onClose={() => setStateDialog(null)}><ArchiveStateForm key={stateDialog.id + stateDialog.version} archive={stateDialog} busy={busy} setBusy={setBusy} onSaved={saved} onReload={async () => {
        const r = await api<{
          archive: Archive;
        }>('/archives/' + stateDialog.id);
        setStateDialog(current => current?.id === r.archive.id && current.version <= r.archive.version ? r.archive : current);
        refresh();
      }} /></Modal>}
 </>;
}
