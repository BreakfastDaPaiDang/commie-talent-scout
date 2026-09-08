import React, { useRef } from "react";
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
export function ArchiveList({ w }) {
  const states = w.page === "org" ? orgStates : personStates;
  return (
    <>
      <section className="list-toolbar">
        <div className="search-field">
          <Icon name="search" />
          <input
            aria-label="搜索档案"
            placeholder="搜索名称、观察内容"
            value={w.search}
            onChange={(e) => w.setSearch(e.target.value)}
          />
          {w.search && (
            <IconButton
              name="close"
              label="清空搜索"
              onClick={() => w.setSearch("")}
            />
          )}
        </div>
        <div className="filter-row">
          <select
            aria-label="筛选业务状态"
            value={w.stateFilter}
            onChange={(e) => w.setStateFilter(e.target.value)}
          >
            <option value="all">全部状态</option>
            {states.map((s) => (
              <option key={s}>{s}</option>
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
        <div className="list-caption">
          <span>{w.filtered.length} 个档案</span>
          <span>最近更新 ↓</span>
        </div>
      </section>
      <div className="entity-list">
        {w.filtered.length ? (
          w.filtered.map((e) => {
            const latest = e.records.find((r) => !r.deleted),
              bound = e.owners[e.state] ?? [],
              working = isWorkState(e.type, e.state);
            return (
              <button
                className={`entity-row ${w.selected === e.id ? "selected" : ""}`}
                key={e.id}
                onClick={() => w.pick(e.id)}
              >
                <Avatar
                  type={e.type}
                  name={e.name}
                  src={e.avatar}
                  contacts={e.contacts}
                />
                <div className="row-content">
                  <div className="row-title">
                    <h2>{e.name}</h2>
                    {w.unreadItems(e).length > 0 && (
                      <span className="unread-dot" aria-label="有未读更新" />
                    )}
                    <Icon name="arrow" size={19} />
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
                  </div>
                  <p className="record-excerpt">
                    {latest?.body ?? "还没有观察记录"}
                  </p>
                  <div className="row-foot">
                    <span>
                      {bound.length
                        ? `${working ? "负责" : "关联"} · ${bound.map(w.memberName).join("、")}`
                        : `${e.records.filter((r) => !r.deleted).length} 条观察`}
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
            title="没有找到对应档案"
            action={
              <Button
                variant="outline"
                onClick={() => {
                  w.setSearch("");
                  w.setStateFilter("all");
                  w.setLifeFilter("all");
                  w.setOwnerFilter([]);
                }}
              >
                清除筛选
              </Button>
            }
          >
            换个关键词，或调整筛选条件。
          </Empty>
        )}
      </div>
    </>
  );
}

export function Updates({ w }) {
  return (
    <section className="updates-list">
      <p className="section-description">打开对应内容，阅读进度会自动更新。</p>
      {w.unreadEntities.length ? (
        w.unreadEntities.map((e) => {
          const pending = w.unreadItems(e),
            latest = pending.sort(
              (a, b) => timelineOrder(b) - timelineOrder(a),
            )[0];
          return (
            <button
              className={`update-row ${w.selected === e.id ? "selected" : ""}`}
              key={e.id}
              onClick={() => w.pick(e.id)}
            >
              <Avatar
                type={e.type}
                name={e.name}
                contacts={e.contacts}
                src={e.avatar}
              />
              <div>
                <span className="kind-label">
                  {e.type === "person" ? "人物" : "组织"} · {pending.length}{" "}
                  项更新
                </span>
                <h2>{e.name}</h2>
                <p>{latest.kind === "system" ? latest.text : latest.body}</p>
                <time>{latest.time}</time>
              </div>
              <Icon name="arrow" />
            </button>
          );
        })
      ) : (
        <Empty title="更新都看过了">新的观察与变化，会出现在这里。</Empty>
      )}
    </section>
  );
}

export function Detail({ w }) {
  const { entity, locked, actor, memberName } = w,
    textarea = useRef(null),
    work = isWorkState(entity.type, entity.state),
    owners = entity.owners[entity.state] ?? [];
  function addImages(files) {
    const added = imageFiles(files, w.notify);
    w.setImages((old) => {
      if (old.length + added.length > 10) w.notify("每条记录最多 10 张图片");
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
          <IconButton
            name="expand"
            label={w.detailWide ? "收起阅读视图" : "展开阅读视图"}
            onClick={() => w.setDetailWide(!w.detailWide)}
          />
          <IconButton
            name="close"
            label="关闭档案详情"
            onClick={() =>
              w.attempt(() => {
                w.setSelected(null);
                w.clearDraft();
              })
            }
          />
        </div>
      </div>
      <div className="detail-scroll" key={entity.id}>
        <div className="detail-inner">
          <header className="entity-header">
            <div className="entity-identity">
              <Avatar
                type={entity.type}
                name={entity.name}
                contacts={entity.contacts}
                src={entity.avatar}
                size="hero"
              />
              <div className="entity-heading">
                <span className="entity-overline">
                  {locked ? "档案已关闭" : work ? "工作进行中" : "持续观察"}
                </span>
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
                    const m = w.members.find((x) => x.id === id);
                    return (
                      <span className="member-chip" key={id}>
                        <Avatar name={m?.name} qq={m?.qq} size="micro" />
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
              {entity.contacts.map((c, i) => (
                <span className="contact-pill" key={i}>
                  <small>{c.type}</small>
                  <span>{c.value}</span>
                </span>
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
                aria-selected={w.recordView === key}
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
            <section className={`composer ${w.composeOpen ? "open" : ""}`}>
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
          <section className="timeline">
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
