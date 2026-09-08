import { useState, useEffect } from "react";
import {
  initialEntities,
  initialMembers,
  isWorkState,
  isClosed,
  uuid,
  stamp,
  canViewRecord,
  canEditRecord,
  timelineOrder,
  itemKey,
  updateActor,
} from "./model.js";

export function useWorkspace() {
  const [entities, setEntities] = useState(initialEntities),
    [members, setMembers] = useState(initialMembers);
  const [actorId, setActorId] = useState("zhou"),
    [page, setPage] = useState("person"),
    [selected, setSelected] = useState("p1");
  const [search, setSearch] = useState(""),
    [stateFilter, setStateFilter] = useState("all"),
    [lifeFilter, setLifeFilter] = useState("open"),
    [ownerFilter, setOwnerFilter] = useState([]);
  const [recordView, setRecordView] = useState("all"),
    [dialog, setDialog] = useState(null),
    [toast, setToast] = useState("");
  const [text, setText] = useState(""),
    [images, setImages] = useState([]),
    [composeOpen, setComposeOpen] = useState(false);
  const [readByMember, setReadByMember] = useState({}),
    [detailWide, setDetailWide] = useState(false),
    [menuOpen, setMenuOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(
    new URLSearchParams(location.search).get("page") !== "login",
  );
  const actor = members.find((m) => m.id === actorId),
    entity = entities.find((e) => e.id === selected);
  const memberName = (id) => members.find((m) => m.id === id)?.name ?? id;
  const notify = (message) => setToast(message),
    closeDialog = () => setDialog(null);
  const locked = entity && isClosed(entity.state),
    detailVisible = !!entity && ["person", "org", "unread"].includes(page);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3600);
    return () => clearTimeout(timer);
  }, [toast]);
  const isUnread = (e, item) =>
    item.isNew &&
    updateActor(item) !== actorId &&
    !(readByMember[actorId] ?? []).includes(itemKey(e.id, item));
  const unreadItems = (e) =>
    [...e.records.filter((r) => !r.deleted), ...e.events].filter((item) =>
      isUnread(e, item),
    );
  const unreadEntities = entities.filter((e) => unreadItems(e).length);
  const markSeen = (token) =>
    setReadByMember((prev) => ({
      ...prev,
      [actorId]: [...new Set([...(prev[actorId] ?? []), token])],
    }));
  const draftDirty = !!text.trim() || images.length > 0;
  function attempt(action) {
    if (draftDirty) setDialog({ type: "leave", action });
    else action();
  }
  function clearDraft() {
    setText("");
    setImages([]);
    setComposeOpen(false);
  }
  function navigate(next) {
    attempt(() => {
      setPage(next);
      setSelected(null);
      setSearch("");
      setStateFilter("all");
      setLifeFilter("open");
      setOwnerFilter([]);
      setMenuOpen(false);
      setDetailWide(false);
      clearDraft();
    });
  }
  function pick(id) {
    attempt(() => {
      setSelected(id);
      setRecordView("all");
      setDetailWide(false);
      clearDraft();
    });
  }
  function patchEntity(id, change, message) {
    setEntities((prev) => {
      const old = prev.find((e) => e.id === id);
      const next = change(structuredClone(old));
      return [
        { ...next, updated: stamp() },
        ...prev.filter((e) => e.id !== id),
      ];
    });
    if (message) notify(message);
  }
  function event(target, message) {
    target.events.unshift({
      id: uuid(),
      kind: "system",
      actor: actorId,
      time: stamp(),
      order: Date.now(),
      text: message,
      isNew: true,
    });
    return target;
  }
  function saveState(next, owners) {
    if (isWorkState(entity.type, next) && !owners.length) {
      notify("工作状态必须指定负责成员");
      return;
    }
    const sameState = next === entity.state;
    if (
      sameState &&
      JSON.stringify(owners) === JSON.stringify(entity.owners[next] ?? [])
    ) {
      closeDialog();
      notify("内容没有变化");
      return;
    }
    patchEntity(
      entity.id,
      (d) => {
        const before = d.state;
        if (!isClosed(before) && isClosed(next)) d.lastOpenState = before;
        d.state = next;
        if (!isClosed(next)) d.owners[next] = owners;
        const message = sameState
          ? `调整了当前${isWorkState(d.type, next) ? "负责" : "关联"}成员：${owners.map(memberName).join("、") || "暂无"}`
          : `业务状态从「${before}」改为「${next}」${isClosed(next) ? "，档案已关闭" : isClosed(before) ? "，档案已重新开启" : ""}${!isClosed(next) && owners.length ? `；${isWorkState(d.type, next) ? "负责" : "关联"}成员：${owners.map(memberName).join("、")}` : ""}`;
        return event(d, message);
      },
      "状态与成员已保存",
    );
    closeDialog();
  }
  function saveEntity(data) {
    if (dialog.type === "entity-new") {
      const id = uuid();
      setEntities((prev) => [
        {
          id,
          type: page,
          name: data.name,
          contacts: data.contacts,
          avatar: data.avatar,
          state: data.state,
          owners: { [data.state]: data.owners },
          updated: stamp(),
          records: [],
          events: [],
        },
        ...prev,
      ]);
      setSelected(id);
      setRecordView("all");
      notify("档案已创建");
    } else {
      const unchanged =
        entity.name === data.name &&
        (entity.avatar ?? "") === data.avatar &&
        JSON.stringify(
          entity.contacts.map(({ type, value }) => ({ type, value })),
        ) === JSON.stringify(data.contacts) &&
        JSON.stringify(entity.owners[entity.state] ?? []) ===
          JSON.stringify(data.owners);
      if (unchanged) {
        closeDialog();
        notify("内容没有变化");
        return;
      }
      patchEntity(
        entity.id,
        (d) => {
          d.name = data.name;
          d.contacts = data.contacts;
          d.avatar = data.avatar;
          d.owners[d.state] = data.owners;
          return event(d, "更新了档案资料与当前关联");
        },
        "资料已保存",
      );
    }
    closeDialog();
  }
  function publish() {
    if (!entity || locked || (!text.trim() && !images.length)) return;
    const time = stamp();
    patchEntity(
      entity.id,
      (d) => {
        d.records.unshift({
          id: uuid(),
          author: actorId,
          time,
          order: Date.now(),
          body: text.trim(),
          images,
          deleted: false,
          isNew: true,
          versions: [
            {
              body: text.trim(),
              images,
              actor: actorId,
              time,
              operation: "创建",
            },
          ],
        });
        return d;
      },
      "观察记录已发布",
    );
    clearDraft();
  }
  function changeRecord(
    record,
    operation,
    body = record.body,
    nextImages = record.images,
  ) {
    if (locked || !canEditRecord(record, actor)) return;
    if (
      operation === "编辑" &&
      body === record.body &&
      JSON.stringify(nextImages) === JSON.stringify(record.images)
    ) {
      closeDialog();
      notify("内容没有变化");
      return;
    }
    patchEntity(
      entity.id,
      (d) => {
        const r = d.records.find((x) => x.id === record.id);
        if (operation === "编辑") {
          r.body = body;
          r.images = nextImages;
          r.edited = stamp();
        }
        if (operation === "删除") r.deleted = true;
        if (operation === "恢复") r.deleted = false;
        r.isNew = true;
        r.versions.push({
          body: r.body,
          images: r.images,
          actor: actorId,
          time: stamp(),
          operation,
        });
        return event(d, `${operation}了一条观察记录`);
      },
      `记录已${operation}`,
    );
    closeDialog();
  }
  function switchActor(id) {
    if (!id) return;
    setActorId(id);
    if (
      page === "accounts" &&
      members.find((m) => m.id === id)?.role !== "admin"
    ) {
      setPage("person");
      setSelected("p1");
    }
    closeDialog();
    clearDraft();
    notify("预览身份已切换");
  }
  const filtered = entities.filter(
    (e) =>
      e.type === page &&
      (!search ||
        `${e.name} ${e.records
          .filter((r) => !r.deleted)
          .map((r) => r.body)
          .join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (stateFilter === "all" || e.state === stateFilter) &&
      (lifeFilter === "all" ||
        (lifeFilter === "closed") === isClosed(e.state)) &&
      (!ownerFilter.length ||
        (e.owners[e.state] ?? []).some((id) => ownerFilter.includes(id))),
  );
  const visibleRecords =
    entity?.records.filter(
      (r) =>
        canViewRecord(r, actor) &&
        (recordView === "deleted" ? r.deleted : !r.deleted),
    ) ?? [];
  const timeline = entity
    ? [...visibleRecords, ...(recordView === "all" ? entity.events : [])].sort(
        (a, b) => timelineOrder(b) - timelineOrder(a),
      )
    : [];
  const deletedCount =
    entity?.records.filter((r) => r.deleted && canViewRecord(r, actor))
      .length ?? 0;
  return {
    entities,
    setEntities,
    members,
    setMembers,
    actorId,
    actor,
    entity,
    page,
    setPage,
    selected,
    setSelected,
    search,
    setSearch,
    stateFilter,
    setStateFilter,
    lifeFilter,
    setLifeFilter,
    ownerFilter,
    setOwnerFilter,
    recordView,
    setRecordView,
    dialog,
    setDialog,
    toast,
    text,
    setText,
    images,
    setImages,
    composeOpen,
    setComposeOpen,
    detailWide,
    setDetailWide,
    menuOpen,
    setMenuOpen,
    loggedIn,
    setLoggedIn,
    memberName,
    notify,
    closeDialog,
    locked,
    detailVisible,
    isUnread,
    unreadItems,
    unreadEntities,
    markSeen,
    attempt,
    clearDraft,
    navigate,
    pick,
    saveState,
    saveEntity,
    publish,
    changeRecord,
    switchActor,
    filtered,
    visibleRecords,
    timeline,
    deletedCount,
  };
}
