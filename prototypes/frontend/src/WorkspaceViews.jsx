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
export function ArchiveList({ w }) {
  const states = w.page === "org" ? orgStates : personStates;
  const activeFilters =
    w.stateFilter !== "all" ||
    w.lifeFilter !== "open" ||
    w.ownerFilter.length > 0;
  return (
    <>
      <section className="list-toolbar">
        <div className="scope-filter-row">
          <div className="scope-tabs" aria-label="档案范围">
            {[
              ["all", "全部"],
              ["mine", "我负责"],
              ["unread", "有未读"],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={w.scope === key}
                className={w.scope === key ? "active" : ""}
                onClick={() => {
                  w.setScope(key);
                  if (key === "unread") w.setLifeFilter("all");
                  else if (w.scope === "unread") w.setLifeFilter("open");
                }}
              >
                {label}
                <small>{w.scopeCounts[key]}</small>
              </button>
            ))}
          </div>
          <button
            className={`filter-toggle ${activeFilters ? "has-filters" : ""}`}
            aria-expanded={w.filtersOpen}
            onClick={() => w.setFiltersOpen(!w.filtersOpen)}
          >
            <Icon name="filter" size={18} />
            筛选{activeFilters && <span className="unread-dot" />}
          </button>
        </div>
        {w.filtersOpen && (
          <div className="filter-row">
            <select
              aria-label="筛选业务状态"
              value={w.stateFilter}
              onChange={(e) => w.setStateFilter(e.target.value)}
            >
              <option value="all">全部状态</option>
              {states.map((state) => (
                <option key={state}>{state}</option>
              ))}
            </select>
            <MemberPicker
              members={w.members}
              value={w.ownerFilter}
              onChange={w.setOwnerFilter}
              multiple={false}
              label="筛选绑定成员"
              placeholder="全部成员"
            />
            <select
              aria-label="筛选开启关闭"
              value={w.lifeFilter}
              onChange={(e) => w.setLifeFilter(e.target.value)}
            >
              <option value="open">开启中</option>
              <option value="closed">已关闭</option>
              <option value="all">全部档案</option>
            </select>
          </div>
        )}
        <div className="list-caption">
          <span>
            {w.filtered.length} 个档案{w.scope === "mine" && " · 当前工作负责"}
          </span>
          {activeFilters || w.search ? (
            <button onClick={w.resetFilters}>清除条件</button>
          ) : (
            <span>最近更新 ↓</span>
          )}
        </div>
      </section>
      <div className="entity-list">
        {w.filtered.length ? (
          w.filtered.map((e) => {
            const matching = w.search
                ? e.records.find(
                    (r) =>
                      !r.deleted &&
                      r.body.toLowerCase().includes(w.search.toLowerCase()),
                  )
                : null,
              latest = matching ?? e.records.find((r) => !r.deleted),
              bound = e.owners[e.state] ?? [],
              working = isWorkState(e.type, e.state),
              contactMatch = w.search
                ? e.contacts.find((c) =>
                    c.value.toLowerCase().includes(w.search.toLowerCase()),
                  )
                : null;
            return (
              <button
                className={`entity-row ${w.selected === e.id ? "selected" : ""}`}
                key={e.id}
                onClick={() => w.pick(e.id, matching?.id)}
              >
                <Avatar
                  type={e.type}
                  name={e.name}
                  src={e.avatar}
                  contacts={e.contacts}
                />
                <div className="row-content">
                  <div className="row-title">
                    <h2>
                      <Highlight text={e.name} query={w.search} />
                    </h2>
                    {w.unreadItems(e).length > 0 && (
                      <span className="unread-dot" aria-label="有未读更新" />
                    )}
                    <Icon name="arrow" size={18} />
                  </div>
                  <div className="row-meta">
                    <StateBadge entity={e} small />
                    {working && (
                      <span
                        className="work-marker"
                        title="工作状态，须指定负责成员"
                      >
                        ◆
                      </span>
                    )}
                    {w.hasDraft(e.id) && (
                      <span className="draft-tag">草稿</span>
                    )}
                  </div>
                  <div className="row-binding">
                    <span>{working ? "负责人" : "关联"}</span>
                    <span title={bound.map(w.memberName).join("、")}>
                      {bound.length
                        ? bound.map(w.memberName).join("、")
                        : working
                          ? "未指定"
                          : "暂无"}
                    </span>
                  </div>
                  <p className="record-excerpt">
                    <Highlight
                      text={excerpt(
                        contactMatch && !matching
                          ? `${contactMatch.type} ${contactMatch.value}`
                          : (latest?.body ?? "还没有观察记录"),
                        w.search,
                      )}
                      query={w.search}
                    />
                  </p>
                  <div className="row-foot">
                    <span>
                      {e.records.filter((r) => !r.deleted).length} 条观察记录
                    </span>
                    <time>{e.updated}</time>
                  </div>
                </div>
              </button>
            );
          })
        ) : (
          <Empty
            type={w.page}
            title={
              w.scope === "mine" && !w.search
                ? "暂无你负责的工作"
                : "没有找到对应档案"
            }
            action={
              <Button variant="outline" onClick={w.resetFilters}>
                查看全部档案
              </Button>
            }
          >
            {w.scope === "mine" && !w.search
              ? "工作状态中绑定你的档案，会出现在这里。"
              : "换个关键词，或清除筛选条件。"}
          </Empty>
        )}
      </div>
    </>
  );
}
export function Updates({ w }) {
  return (
    <section className="updates-list">
      <p className="section-description">从变化的地方读起。</p>
      {w.unreadEntities.length ? (
        w.sessionUpdates.map((e) => {
          const pending = w.unreadItems(e),
            latest = [
              ...(pending.length
                ? pending
                : [...e.records.filter((r) => !r.deleted), ...e.events]),
            ].sort((a, b) => timelineOrder(b) - timelineOrder(a))[0];
          return (
            <button
              className={`update-row ${w.selected === e.id ? "selected" : ""} ${!pending.length ? "read" : ""}`}
              key={e.id}
              onClick={() => w.openUnread(e)}
            >
              <Avatar
                type={e.type}
                name={e.name}
                contacts={e.contacts}
                src={e.avatar}
              />
              <div>
                <span className="kind-label">
                  {e.type === "person" ? "人物" : "组织"} ·{" "}
                  {pending.length ? `${pending.length} 项更新` : "已阅"}
                </span>
                <h2>{e.name}</h2>
                <p>{latest?.kind === "system" ? latest.text : latest?.body}</p>
                <time>{latest?.time}</time>
              </div>
              <Icon name={pending.length ? "arrow" : "check"} />
            </button>
          );
        })
      ) : (
        <div className="caught-up">
          <img
            src="/art/observation-pause-v3.png"
            alt="放下望远镜，暂歇片刻的观察员"
          />
          <h2>近况，都看过了。</h2>
          <p>新的观察与变化，会在这里等你。</p>
          <Button variant="outline" onClick={() => w.navigate("person")}>
            回到人物档案
          </Button>
        </div>
      )}
    </section>
  );
}

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
    <aside className="detail-panel" aria-label={`${entity.name}档案详情`}>
      <div className="detail-top">
        <span>
          {entity.type === "person" ? "人物档案" : "组织档案"}
          <span className="detail-number">
            / {entity.id.toUpperCase().slice(0, 6)}
          </span>
        </span>
        <div>
          {w.unreadEntities.length > 0 && (
            <button className="next-unread" onClick={w.nextUnread}>
              下一处未读
              <Icon name="arrow" size={15} />
            </button>
          )}
          <IconButton
            name="expand"
            label={w.detailWide ? "收起阅读视图" : "展开阅读视图"}
            onClick={() => w.setDetailWide(!w.detailWide)}
          />
          <IconButton
            name="close"
            label="关闭档案详情"
            onClick={w.closeDetail}
          />
        </div>
      </div>
      <div
        className="detail-scroll"
        key={entity.id}
        ref={scroll}
        onScroll={(event) => {
          w.readingPositions.current[`${w.actorId}:${entity.id}`] =
            event.currentTarget.scrollTop;
        }}
      >
        <div className="detail-inner">
          <header className="entity-header">
            <div className="entity-identity">
              <div className="entity-heading">
                <h1>{entity.name}</h1>
                <StateBadge
                  entity={entity}
                  onClick={
                    locked
                      ? undefined
                      : () =>
                          w.setDialog({
                            type: "state",
                            nextState: entity.state,
                          })
                  }
                />
              </div>
              <Avatar
                type={entity.type}
                name={entity.name}
                contacts={entity.contacts}
                src={entity.avatar}
                size="hero"
              />
              <IconButton
                name="more"
                label="档案操作"
                onClick={() => w.setDialog({ type: "entity-actions" })}
              />
            </div>
            <div className={`assignment-row ${work ? "is-work" : ""}`}>
              <span className="assignment-label">
                {work && <span className="assignment-flag">◆</span>}
                {work
                  ? entity.type === "person"
                    ? "人事负责"
                    : "工作负责"
                  : "关联成员"}
              </span>
              <div className="assigned-members">
                {owners.length ? (
                  owners.map((id) => {
                    const m = w.members.find((member) => member.id === id);
                    return (
                      <span className="member-chip" key={id}>
                        <Avatar
                          name={m?.name}
                          src={m?.avatar}
                          qq={m?.qq}
                          size="micro"
                        />
                        {memberName(id)}
                        {m?.frozen && <small>已冻结</small>}
                      </span>
                    );
                  })
                ) : (
                  <span className="optional-label">暂未关联</span>
                )}
              </div>
              {!locked && (
                <button
                  className="text-button"
                  onClick={() => w.setDialog({ type: "bindings" })}
                >
                  {owners.length ? "调整" : "关联"}
                </button>
              )}
            </div>
            <div className="contacts-bar">
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
            </div>
          </header>
          {locked && (
            <div className="locked-notice">
              <Icon name="lock" />
              <span>只读档案，重新开启后可继续维护。</span>
              <button
                className="text-button"
                onClick={() =>
                  w.setDialog({
                    type: "state",
                    mode: "reopen",
                    nextState: entity.lastOpenState ?? "视奸观察",
                  })
                }
              >
                重新开启
              </button>
            </div>
          )}
          <div className="timeline-tabs" role="tablist" aria-label="动态筛选">
            {[
              ["all", "全部动态"],
              ["records", "观察记录"],
              ["deleted", "已删除"],
            ].map(([key, label]) => (
              <button
                role="tab"
                id={`${entity.id}-tab-${key}`}
                aria-controls={`${entity.id}-timeline`}
                aria-selected={w.recordView === key}
                tabIndex={w.recordView === key ? 0 : -1}
                onKeyDown={(e) => {
                  const tabs = [
                    ...e.currentTarget.parentElement.querySelectorAll(
                      '[role="tab"]',
                    ),
                  ];
                  const index = tabs.indexOf(e.currentTarget);
                  const next = {
                    ArrowRight: (index + 1) % tabs.length,
                    ArrowLeft: (index + tabs.length - 1) % tabs.length,
                    Home: 0,
                    End: tabs.length - 1,
                  }[e.key];
                  if (next === undefined) return;
                  e.preventDefault();
                  tabs[next].click();
                  tabs[next].focus();
                }}
                className={w.recordView === key ? "active" : ""}
                key={key}
                onClick={() => w.setRecordView(key)}
              >
                {label}
                {key === "deleted" && w.deletedCount > 0 && (
                  <small>{w.deletedCount}</small>
                )}
              </button>
            ))}
          </div>
          {!locked && w.recordView !== "deleted" && (
            <section
              className={`composer ${w.composeOpen ? "open" : ""}`}
              aria-label="撰写观察"
            >
              <div className="composer-line">
                <button
                  className="compose-launch"
                  aria-label="开始撰写观察"
                  onClick={() => {
                    w.setComposeOpen(true);
                    textarea.current?.focus();
                  }}
                >
                  <Icon name="plus" size={22} />
                </button>
                <textarea
                  ref={textarea}
                  aria-label="新的观察记录"
                  rows={w.composeOpen ? 3 : 1}
                  placeholder="写下新的观察…"
                  value={w.text}
                  onFocus={() => w.setComposeOpen(true)}
                  onChange={(e) => w.setText(e.target.value)}
                  onPaste={(e) => {
                    const files = [...e.clipboardData.files];
                    if (files.length) {
                      e.preventDefault();
                      addImages(files);
                    }
                  }}
                />
              </div>
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
            </section>
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
            aria-labelledby={`${entity.id}-tab-${w.recordView}`}
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
                    <article
                      className={`observation ${item.deleted ? "deleted" : ""}`}
                    >
                      <header className="record-byline">
                        <Avatar
                          name={memberName(item.author)}
                          qq={w.members.find((m) => m.id === item.author)?.qq}
                          src={
                            w.members.find((m) => m.id === item.author)?.avatar
                          }
                          size="tiny"
                        />
                        <strong>{memberName(item.author)}</strong>
                        {unread && <span className="unread-dot" />}
                        <time>{item.time}</time>
                        {item.edited && <small>已编辑</small>}
                        <IconButton
                          name="history"
                          label={`查看${memberName(item.author)}记录的历史`}
                          onClick={() =>
                            w.setDialog({ type: "history", record: item })
                          }
                        />
                      </header>
                      <div className="record-body">
                        {item.body
                          .split("\n")
                          .filter(Boolean)
                          .map((line, i) => (
                            <p key={i}>{line}</p>
                          ))}
                      </div>
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
                      {!locked && canEditRecord(item, actor) && (
                        <footer className="record-actions">
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
                        </footer>
                      )}
                    </article>
                  )}
                </ReadBoundary>
              );
            })}
          </section>
        </div>
      </div>
    </aside>
  );
}
