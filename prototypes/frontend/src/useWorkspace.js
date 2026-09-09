import { useState, useEffect, useRef } from "react";
import {
  initialEntities,
  prototypeReminder,
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
  const [,refreshReminder]=useState(0);
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')refreshReminder(n=>n+1);},60000);return()=>clearInterval(timer);},[]);
  const [entities, setEntities] = useState(()=>new URLSearchParams(location.search).has('reminders')?initialEntities.map(e=>({...e,updated_at:new Date(Date.now()-(isWorkState(e.type,e.state)&&e.type==='person'?9:35)*86400000).toISOString()})):initialEntities),
    [members, setMembers] = useState(initialMembers);
  const [actorId, setActorId] = useState("zhou"),
    [page, setPage] = useState(
      new URLSearchParams(location.search).get("page") === "agent"
        ? "agent"
        : "person",
    ),
    [selected, setSelected] = useState("p1");
  const [listState, setListState] = useState({});
  const listKey = `${actorId}:${page}`;
  const {
    search = "",
    stateFilter = "all",
    lifeFilter = "open",
    ownerFilter = [],
    scope = "all",
    filtersOpen = false,
  } = listState[listKey] ?? {};
  const setListField = (field, value) =>
    setListState((previous) => ({
      ...previous,
      [listKey]: { ...previous[listKey], [field]: value },
    }));
  const setSearch = (value) => setListField("search", value),
    setStateFilter = (value) => setListField("stateFilter", value),
    setLifeFilter = (value) => setListField("lifeFilter", value),
    setOwnerFilter = (value) => setListField("ownerFilter", value),
    setScope = (value) => setListField("scope", value),
    setFiltersOpen = (value) => setListField("filtersOpen", value);
  const [recordView, setRecordView] = useState("all"),
    [dialog, setDialog] = useState(null),
    [toast, setToast] = useState("");
  const [drafts, setDrafts] = useState({});
  const draftKey = `${actorId}:${selected}`;
  const {
    text = "",
    images = [],
    composeOpen = false,
  } = drafts[draftKey] ?? {};
  const patchDraft = (field, value) => {
    if (!selected) return;
    setDrafts((previous) => {
      const current = {
        text: "",
        images: [],
        composeOpen: false,
        ...previous[draftKey],
      };
      return {
        ...previous,
        [draftKey]: {
          ...current,
          [field]: typeof value === "function" ? value(current[field]) : value,
        },
      };
    });
  };
  const setText = (value) => patchDraft("text", value),
    setImages = (value) => patchDraft("images", value),
    setComposeOpen = (value) => patchDraft("composeOpen", value);
  const selectionMemory = useRef({}),
    readingPositions = useRef({});
  const [focusTarget, setFocusTarget] = useState(null),
    [unreadSessionIds, setUnreadSessionIds] = useState([]);
  const [readByMember, setReadByMember] = useState({}),
    [detailWide, setDetailWide] = useState(false),
    [menuOpen, setMenuOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(
    new URLSearchParams(location.search).get("page") !== "login",
  );
  const actor = members.find((m) => m.id === actorId),
    entity = entities.find((e) => e.id === selected);
  const memberName = (id) => members.find((m) => m.id === id)?.name ?? id;
  const notify = (message, tone = "success") =>
      setToast({ message, tone, id: Date.now() }),
    closeDialog = () => {
      setDialog(null);
      setToast((current) => (current?.tone === "error" ? "" : current));
    };
  const locked = entity && isClosed(entity.state),
    detailVisible = !!entity && ["person", "org", "unread"].includes(page);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast(""),
      toast.tone === "error" ? 6500 : 3600,
    );
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
  const markArchiveSeen = (tokens) =>
    setReadByMember((prev) => ({
      ...prev,
      [actorId]: [...new Set([...(prev[actorId] ?? []), ...tokens])],
    }));
  const draftDirty = !!text.trim() || images.length > 0;
  const hasDraft = (id) => {
    const value = drafts[`${actorId}:${id}`];
    return !!value?.text?.trim() || !!value?.images?.length;
  };
  function clearDraft() {
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[draftKey];
      return next;
    });
  }
  function navigate(next) {
    if (next === page) {
      setMenuOpen(false);
      return;
    }
    selectionMemory.current[`${actorId}:${page}`] = selected;
    setPage(next);
    setSelected(selectionMemory.current[`${actorId}:${next}`] ?? null);
    setFocusTarget(null);
    setMenuOpen(false);
    setDetailWide(false);
    setRecordView("all");
    if (next === "unread") setUnreadSessionIds(unreadEntities.map((e) => e.id));
  }
  function pick(id, targetId) {
    setSelected(id);
    setRecordView("all");
    setDetailWide(false);
    setFocusTarget(
      targetId ? { entityId: id, itemId: targetId, request: uuid() } : null,
    );
  }
  function closeDetail() {
    setSelected(null);
    setFocusTarget(null);
  }
  function openUnread(e) {
    const pending = unreadItems(e).sort(
      (a, b) => timelineOrder(b) - timelineOrder(a),
    );
    pick(e.id, pending[0]?.id);
  }
  function nextUnread() {
    const candidates = entities.filter((e) => e.id !== selected);
    const next = candidates.find((e) => unreadItems(e).length);
    if (next) {
      if (page !== "unread") navigate("unread");
      openUnread(next);
    }
  }
  function resetFilters() {
    setListState((previous) => ({
      ...previous,
      [listKey]: {
        search: "",
        stateFilter: "all",
        lifeFilter: "open",
        ownerFilter: [],
        scope: "all",
        filtersOpen: false,
      },
    }));
  }
  const matching = entities.filter(e =>
    e.type === page &&
    (!search || `${e.name} ${e.contacts.map(c => c.value).join(" ")} ${e.records.filter(r => !r.deleted).map(r => r.body).join(" ")}`.toLowerCase().includes(search.toLowerCase())) &&
    (stateFilter === "all" || e.state === stateFilter) &&
    (lifeFilter === "all" || (lifeFilter === "closed") === isClosed(e.state)) &&
    (!ownerFilter.length || (e.owners[e.state] ?? []).some(id => ownerFilter.includes(id))),
  );
  const associated = e => (e.owners[e.state] ?? []).includes(actorId);
  const scopeCounts = {
    all: matching.length,
    mine: matching.filter(associated).length,
    unread: matching.filter(e => unreadItems(e).length).length,
  };
  const sessionUpdates = [
    ...new Set([...unreadSessionIds, ...unreadEntities.map((e) => e.id)]),
  ]
    .map((id) => entities.find((e) => e.id === id))
    .filter(Boolean);
  function patchEntity(id, change, message) {
    setEntities((prev) => {
      const old = prev.find((e) => e.id === id);
      const next = change(structuredClone(old));
      return [
        { ...next, updated: stamp(), updated_at: new Date().toISOString() },
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
      notify("工作状态必须指定负责成员", "error");
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
          links: data.links,
          avatar: data.avatar,
          state: data.state,
          owners: { [data.state]: data.owners },
          updated: stamp(), updated_at: new Date().toISOString(),
          records: [],
          events: [],
        },
        ...prev,
      ]);
      resetFilters();
      setSelected(id);
      setRecordView("all");
      notify("档案已创建");
    } else {
      const unchanged =
        entity.name === data.name &&
        (entity.avatar ?? "") === data.avatar &&
        JSON.stringify(
          entity.contacts.map(({ type, value, note }) => ({ type, value, note:note??'' })),
        ) === JSON.stringify(data.contacts) && JSON.stringify(entity.links??[])===JSON.stringify(data.links??[]) &&
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
          d.links = data.links;
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
    setFocusTarget(null);
    notify("预览身份已切换");
  }
  const filtered = matching.filter(e => scope === "all" || (scope === "mine" ? associated(e) : unreadItems(e).length > 0))
    .sort((a,b)=>{const x=prototypeReminder(a),y=prototypeReminder(b);return Number(y.overdue)-Number(x.overdue)||(x.overdue&&y.overdue?Date.parse(x.due_at)-Date.parse(y.due_at):0);});
  useEffect(() => {
    if (
      ["person", "org"].includes(page) &&
      selected &&
      !filtered.some((e) => e.id === selected)
    )
      setSelected(null);
  }, [
    page,
    selected,
    search,
    stateFilter,
    lifeFilter,
    ownerFilter,
    scope,
    entities,
    actorId,
  ]);
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
    markArchiveSeen,
    draftDirty,
    hasDraft,
    scope,
    setScope,
    scopeCounts,
    filtersOpen,
    setFiltersOpen,
    resetFilters,
    focusTarget,
    readingPositions,
    sessionUpdates,
    openUnread,
    nextUnread,
    closeDetail,
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
