import {ArchiveLifecycleNotice} from '../../../app/ui/ArchiveLifecycle';
import {CaughtUp,UpdateRow,ArchiveRow,ScopeToolbar,DetailFrame,EntityHeader,TimelineTabs,ComposerFrame,ObservationFrame,RecordBody} from '../../../app/ui/Workspace';
import React, { useRef, useEffect, useLayoutEffect } from "react";
import { Icon } from "./icons.jsx";
import { Avatar } from "./Avatar.jsx";
import {
  Button,
  IconButton,
  Empty,
  Images,
  ImageInput,
  imageFiles,
  ReadBoundary,
} from "./components.jsx";
import { MemberPicker } from "./MemberPicker.jsx";
import {
  isWorkState,
  isClosed,
  personStates,
  orgStates,
  timelineOrder,
  itemKey,
  canEditRecord,
} from "./model.js";

export function StateBadge({ entity, onClick, small = false }) {
  const style = `state-badge ${isWorkState(entity.type, entity.state) ? "work" : ""} ${isClosed(entity.state) ? "closed" : ""} ${small ? "small" : ""}`;
  return onClick ? (
    <button className={style} onClick={onClick}>
      <span>{entity.state}</span>
      <Icon name="down" size={16} />
    </button>
  ) : (
    <span className={style}>{entity.state}</span>
  );
}
function Highlight({ text = "", query = "" }) {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}
function excerpt(text, query) {
  const flat = text.replace(/\s+/g, " "),
    index = query ? flat.toLowerCase().indexOf(query.toLowerCase()) : -1;
  return index > 45 ? "…" + flat.slice(index - 30, index + 125) : flat;
}
export function ArchiveSearch({ w }) {
  const searchRef = useRef(null);
  useEffect(() => {
    const key = (e) => {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) &&
        !e.target.isContentEditable &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  return (
    <div className="search-field">
      <Icon name="search" />
      <input
        ref={searchRef}
        aria-label="搜索档案"
        placeholder="搜索档案、观察"
        value={w.search}
        onChange={(e) => w.setSearch(e.target.value)}
      />
      {w.search ? (
        <IconButton
          name="close"
          label="清空搜索"
          onClick={() => w.setSearch("")}
        />
      ) : (
        <kbd>/</kbd>
      )}
    </div>
  );
}
export function ArchiveList({w}) {
 const states=w.page==='org'?orgStates:personStates,activeFilters=w.stateFilter!=='all'||w.lifeFilter!=='open'||w.ownerFilter.length>0;
 return <><ScopeToolbar scope={w.scope} counts={w.scopeCounts} onScope={key=>{w.setScope(key);if(key==='unread')w.setLifeFilter('all');else if(w.scope==='unread')w.setLifeFilter('open');}} filtersOpen={w.filtersOpen} onFilters={()=>w.setFiltersOpen(!w.filtersOpen)} activeFilters={activeFilters} onReset={activeFilters||w.search?w.resetFilters:undefined} filters={<><select aria-label="筛选业务状态" value={w.stateFilter} onChange={e=>w.setStateFilter(e.target.value)}><option value="all">全部状态</option>{states.map(state=><option key={state}>{state}</option>)}</select><MemberPicker members={w.members} value={w.ownerFilter} onChange={w.setOwnerFilter} multiple={false} label="筛选绑定成员" placeholder="全部成员"/><select aria-label="筛选开启关闭" value={w.lifeFilter} onChange={e=>w.setLifeFilter(e.target.value)}><option value="open">开启中</option><option value="closed">已关闭</option><option value="all">全部档案</option></select></>}/>
 <div className="entity-list">{w.filtered.length?w.filtered.map(e=>{const matching=w.search?e.records.find(r=>!r.deleted&&r.body.toLowerCase().includes(w.search.toLowerCase())):null,latest=matching??e.records.find(r=>!r.deleted),bound=e.owners[e.state]??[],working=isWorkState(e.type,e.state),contactMatch=w.search?e.contacts.find(c=>c.value.toLowerCase().includes(w.search.toLowerCase())):null;return <ArchiveRow key={e.id} selected={w.selected===e.id} onClick={()=>w.pick(e.id,matching?.id)} avatar={<Avatar type={e.type} name={e.name} src={e.avatar} contacts={e.contacts}/>} name={<Highlight text={e.name} query={w.search}/>} unread={w.unreadItems(e).length>0} state={<StateBadge entity={e} small/>} status={e.state} draft={w.hasDraft(e.id)} binding={bound.length?bound.map(id=>{const m=w.members.find(m=>m.id===id);return <span className="member-chip" key={id}><Avatar name={m?.name} src={m?.avatar} size="micro"/>{w.memberName(id)}</span>}):null} excerpt={<Highlight text={excerpt(contactMatch&&!matching?`${contactMatch.type} ${contactMatch.value}`:latest?.body??'还没有观察记录',w.search)} query={w.search}/>} footer={<><span>{e.records.filter(r=>!r.deleted).length} 条观察记录</span><time>{e.updated}</time></>}/>;}):<Empty type={w.page} title="没有找到对应档案" action={<Button variant="outline" onClick={w.resetFilters}>查看全部档案</Button>}>换个关键词，或清除筛选条件。</Empty>}</div></>;
}
export function Updates({w}){return <section className="updates-list"><p className="section-description">从变化的地方读起。</p>{w.unreadEntities.length?w.sessionUpdates.map(e=>{const pending=w.unreadItems(e),latest=[...(pending.length?pending:[...e.records.filter(r=>!r.deleted),...e.events])].sort((a,b)=>timelineOrder(b)-timelineOrder(a))[0];return <UpdateRow key={e.id} selected={w.selected===e.id} read={!pending.length} onClick={()=>w.openUnread(e)} avatar={<Avatar type={e.type} name={e.name} contacts={e.contacts} src={e.avatar}/>} label={<>{e.type==='person'?'人物':'组织'} · {pending.length?`${pending.length} 项更新`:'已阅'}</>} name={e.name} excerpt={latest?.kind==='system'?latest.text:latest?.body} time={latest?.time}/>;}):<CaughtUp action={<Button variant="outline" onClick={()=>w.navigate('person')}>回到人物档案</Button>}/>}</section>;}

export function Detail({ w }) {
  const { entity, locked, actor, memberName } = w,
    textarea = useRef(null),
    scroll = useRef(null),
    work = isWorkState(entity.type, entity.state),
    owners = entity.owners[entity.state] ?? [];
  useLayoutEffect(() => {
    const target =
      w.focusTarget?.entityId === entity.id
        ? document.getElementById(`entry-${w.focusTarget.itemId}`)
        : null;
    if (target) {
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
    } else if (scroll.current)
      scroll.current.scrollTop =
        w.readingPositions.current[`${w.actorId}:${entity.id}`] ?? 0;
  }, [entity.id, w.focusTarget?.request, w.actorId]);
  function addImages(files) {
    const added = imageFiles(files, w.notify);
    w.setImages((old) => {
      if (old.length + added.length > 10)
        w.notify("每条记录最多 10 张图片", "error");
      return [...old, ...added].slice(0, 10);
    });
    w.setComposeOpen(true);
  }
  return (
    <DetailFrame label={entity.type==='person'?'人物档案':'组织档案'} code={entity.id.toUpperCase().slice(0,6)} expanded={w.detailWide} onExpand={()=>w.setDetailWide(!w.detailWide)} onClose={w.closeDetail} onNextUnread={w.unreadEntities.length?w.nextUnread:undefined} scrollRef={scroll} onScroll={event=>{w.readingPositions.current[`${w.actorId}:${entity.id}`]=event.currentTarget.scrollTop;}}>
          <EntityHeader name={entity.name} state={<StateBadge entity={entity} onClick={locked?undefined:()=>w.setDialog({type:'state',nextState:entity.state})}/>} avatar={<Avatar type={entity.type} name={entity.name} contacts={entity.contacts} src={entity.avatar} size="hero"/>} actions={<IconButton name="more" label="档案操作" onClick={()=>w.setDialog({type:'entity-actions'})}/>} assignment={owners.length>0&&<div className="assignment-row"><div className="assigned-members">{owners.map(id=>{const m=w.members.find(m=>m.id===id);return <span className="member-chip" key={id}><Avatar name={m?.name} src={m?.avatar} qq={m?.qq} size="micro"/>{memberName(id)}{m?.frozen&&<small>已冻结</small>}</span>})}</div></div>} contacts={<>
              {entity.contacts.map((contact, i) => (
                <button
                  className="contact-pill"
                  key={i}
                  title={`复制${contact.type}`}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(contact.value);
                      w.notify(`${contact.type}已复制`);
                    } catch {
                      w.notify("复制未成功，可选择文字复制", "error");
                    }
                  }}
                >
                  <small>{contact.type}</small>
                  <span>{contact.value}</span>
                  <Icon name="copy" size={13} />
                </button>
              ))}
              {!locked && (
                <Button
                  variant="quiet"
                  icon="edit"
                  onClick={() => w.setDialog({ type: "entity-edit" })}
                >
                  编辑资料
                </Button>
              )}
</>}/>
          <ArchiveLifecycleNotice deleted={false} closed={locked} onReopen={()=>w.setDialog({type:'state',mode:'reopen',nextState:entity.lastOpenState??'视奸观察'})}/>
          <TimelineTabs id={entity.id} value={w.recordView==='records'?'observations':w.recordView} onChange={value=>w.setRecordView(value==='observations'?'records':value)} deletedCount={w.deletedCount}/>
          {!locked && w.recordView !== "deleted" && (
            <ComposerFrame open={w.composeOpen} onOpen={()=>w.setComposeOpen(true)} textarea={{value:w.text,onChange:e=>w.setText(e.target.value),onPaste:e=>{const files=[...e.clipboardData.files];if(files.length){e.preventDefault();addImages(files);}}}}>
              {w.composeOpen && (
                <>
                  <Images
                    images={w.images}
                    onOpen={(im) => w.setDialog({ type: "image", image: im })}
                    onRemove={(i) =>
                      w.setImages((p) => p.filter((_, n) => n !== i))
                    }
                  />
                  <p className="draft-note">
                    {w.draftDirty
                      ? "草稿随此档案保留，本次预览刷新后清空。"
                      : "写下具体的交流、行动或变化。"}
                  </p>
                  <div className="composer-foot">
                    <ImageInput onFiles={addImages} />
                    <Button
                      variant="primary"
                      disabled={!w.text.trim() && !w.images.length}
                      onClick={w.publish}
                    >
                      发布记录
                      <Icon name="arrow" size={17} />
                    </Button>
                  </div>
                </>
              )}
            </ComposerFrame>
          )}
          {w.recordView === "deleted" && (
            <p className="deleted-explanation">
              {actor.role === "admin"
                ? "管理员可查看全部已删除记录。"
                : "这里只展示你作为原作者的已删除记录。"}
            </p>
          )}
          <section
            className="timeline"
            role="tabpanel"
            id={`${entity.id}-timeline`}
            aria-labelledby={`${entity.id}-tab-${w.recordView==='records'?'observations':w.recordView}`}
            tabIndex={0}
          >
            {!w.visibleRecords.length && (
              <Empty
                type={entity.type}
                title={
                  w.recordView === "deleted"
                    ? "暂无可查看的已删除记录"
                    : "还没有观察记录"
                }
              >
                {w.recordView === "deleted"
                  ? "已删除内容按原始作者与管理员权限展示。"
                  : "从一句观察开始，慢慢了解这个对象。"}
              </Empty>
            )}
            {w.timeline.map((item) => {
              const token = itemKey(entity.id, item),
                unread = w.isUnread(entity, item);
              return (
                <ReadBoundary
                  key={token}
                  id={`entry-${item.id}`}
                  highlighted={
                    w.focusTarget?.entityId === entity.id &&
                    w.focusTarget?.itemId === item.id
                  }
                  token={token}
                  enabled={unread && w.recordView !== "deleted"}
                  paused={!!w.dialog}
                  onRead={w.markSeen}
                >
                  {item.kind === "system" ? (
                    <div className="system-event">
                      <span className="event-node" />
                      <div>
                        <span>{memberName(item.actor)}</span> {item.text}
                        <time>{item.time}</time>
                      </div>
                    </div>
                  ) : (
                    <ObservationFrame id={`observation-${item.id}`} avatar={<Avatar name={memberName(item.author)} qq={w.members.find(m=>m.id===item.author)?.qq} src={w.members.find(m=>m.id===item.author)?.avatar} size="tiny"/>} author={memberName(item.author)} time={item.time} edited={item.edited?'已编辑':undefined} unread={unread} onHistory={()=>w.setDialog({type:'history',record:item})} historyLabel={`查看${memberName(item.author)}记录的历史`} deleted={item.deleted} footer={<>                      {!locked && canEditRecord(item, actor) && (
                        <>
                          {item.deleted ? (
                            <button
                              onClick={() => w.changeRecord(item, "恢复")}
                            >
                              <Icon name="history" size={16} />
                              恢复记录
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() =>
                                  w.setDialog({
                                    type: "record-edit",
                                    record: item,
                                  })
                                }
                              >
                                编辑
                              </button>
                              <button
                                onClick={() =>
                                  w.setDialog({
                                    type: "record-delete",
                                    record: item,
                                  })
                                }
                              >
                                删除
                              </button>
                            </>
                          )}
                        </>
                      )}
</>}>
                      <RecordBody body={item.body}/>
                      <Images
                        images={item.images}
                        onOpen={(im) =>
                          w.setDialog({
                            type: "image",
                            image: im,
                            record: item,
                          })
                        }
                      />
                    </ObservationFrame>
                  )}
                </ReadBoundary>
              );
            })}
          </section>
    </DetailFrame>
  );
}
