import React, { useState, useRef, useEffect, useId } from "react";
import { Icon } from "./icons.jsx";
import { Avatar } from "./Avatar.jsx";

export function MemberPicker({
  members,
  value = [],
  onChange,
  label = "选择成员",
  multiple = true,
  placeholder = "搜索并选择成员",
  disabled = false,
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [placement, setPlacement] = useState({ above: false, height: 240 });
  const root = useRef(null),
    input = useRef(null),
    listId = useId();
  const results = members.filter(
    (m) =>
      (!m.frozen || value.includes(m.id)) &&
      `${m.name} ${m.username}`.toLowerCase().includes(query.toLowerCase()),
  );
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open)
      root.current
        ?.querySelector(".keyboard-current")
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  function toggle() {
    if (!open) {
      const box = root.current.getBoundingClientRect(),
        dialog = root.current.closest("dialog")?.getBoundingClientRect(),
        top = box.top - (dialog?.top ?? 0) - 65,
        bottom = (dialog?.bottom ?? window.innerHeight) - box.bottom - 12,
        above = bottom < 340 && top > bottom;
      setPlacement({
        above,
        height: Math.max(90, Math.min(240, (above ? top : bottom) - 110)),
      });
    }
    setOpen(!open);
  }
  const select = (id) => {
    if (disabled) return;
    onChange(
      multiple
        ? value.includes(id)
          ? value.filter((x) => x !== id)
          : [...value, id]
        : [id],
    );
    setQuery("");
    if (!multiple) setOpen(false);
    else input.current?.focus();
  };
  return (
    <div className={`member-picker ${open ? "is-open" : ""}`} ref={root}>
      <button
        className="member-trigger"
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={toggle}
      >
        <span>
          {value.length
            ? value
                .map((id) => members.find((m) => m.id === id)?.name)
                .join("、")
            : placeholder}
        </span>
        <Icon name="down" size={17} />
      </button>
      {open && (
        <div className={`member-menu ${placement.above ? "opens-up" : ""}`}>
          <div className="member-search">
            <Icon name="search" />
            <input
              ref={input}
              role="combobox"
              aria-label={`${label}搜索`}
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={
                results[active] ? `${listId}-${results[active].id}` : undefined
              }
              autoComplete="off"
              placeholder="输入姓名或账号"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setOpen(false);
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((n) =>
                    Math.max(0, Math.min(n + 1, results.length - 1)),
                  );
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((n) => Math.max(n - 1, 0));
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (results[active]) select(results[active].id);
                }
              }}
            />
          </div>
          <div
            className="member-options"
            style={{ maxHeight: placement.height }}
            role="listbox"
            id={listId}
            aria-label={`${label}结果`}
            aria-multiselectable={multiple}
          >
            {results.length ? (
              results.map((m, i) => (
                <button
                  key={m.id}
                  id={`${listId}-${m.id}`}
                  type="button"
                  role="option"
                  aria-selected={value.includes(m.id)}
                  className={i === active ? "keyboard-current" : ""}
                  disabled={m.frozen && !value.includes(m.id)}
                  onClick={() => select(m.id)}
                >
                  <Avatar name={m.name} src={m.avatar} qq={m.qq} size="tiny" />
                  <span>
                    {m.name}
                    <small>{m.frozen ? "已冻结" : m.username}</small>
                  </span>
                  {value.includes(m.id) ? (
                    <Icon name="check" size={18} />
                  ) : (
                    <Icon name="plus" size={15} />
                  )}
                </button>
              ))
            ) : (
              <p className="picker-empty">没有找到成员</p>
            )}
          </div>
          <div className="member-menu-foot">
            <span>{multiple ? `已选 ${value.length} 人` : "选择一名成员"}</span>
            {!!value.length && (
              <button type="button" onClick={() => onChange([])}>
                清空
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)}>
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
