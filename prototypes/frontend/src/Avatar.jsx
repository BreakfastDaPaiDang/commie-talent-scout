import React, { useState } from "react";

// Small, original vector characters distilled from the avatar exploration sheet.
// The observer and clubhouse remain distinct even at 32 px; no initials.
export function Placeholder({ type = "person", className = "" }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" fill="var(--avatar-paper, #eeeeee)" />
      {type === "org" ? (
        <>
          <path d="M14 89V46H29V29H68V41H84V89Z" fill="#202020" />
          <path d="M29 29 57 13 76 29Z" fill="#ed3327" />
          <path d="M55 13V3L73 8 55 13" fill="#202020" />
          <path d="M67 42H84V56H75V70H66V89H52V75H60V61H67Z" fill="#fff" />
          <circle cx="39" cy="48" r="8" fill="#fff" />
          <circle cx="58" cy="48" r="8" fill="#fff" />
          <circle cx="41" cy="49" r="3.5" fill="#202020" />
          <circle cx="60" cy="49" r="3.5" fill="#202020" />
          <path d="M30 89V67H47V89" fill="#ed3327" />
          <circle cx="41" cy="79" r="2" fill="#202020" />
          <path d="M8 91H92" stroke="#202020" strokeWidth="3" />
        </>
      ) : (
        <>
          <path d="M9 100 24 78 41 71 67 75 90 100Z" fill="#202020" />
          <path d="M41 66V79L57 92 68 76 62 64Z" fill="#fff" />
          <path d="M42 77 56 91 48 100H66L58 90 68 76" fill="#ed3327" />
          <path d="M29 27H63L76 42 71 66 52 80 33 66 27 49Z" fill="#fff" />
          <path d="M28 49 18 27 49 11 79 29 48 31 34 52Z" fill="#202020" />
          <path d="M19 28 50 11 61 22 77 28 43 25Z" fill="#ed3327" />
          <path d="M17 34 84 27 78 34 30 39Z" fill="#202020" />
          <path d="M41 38H79V58H42Z" fill="#202020" />
          <ellipse cx="49" cy="48" rx="12" ry="14" fill="#202020" />
          <ellipse cx="77" cy="47" rx="13" ry="15" fill="#202020" />
          <ellipse cx="51" cy="48" rx="7" ry="9" fill="#fff" />
          <ellipse cx="79" cy="47" rx="7" ry="10" fill="#fff" />
          <ellipse cx="53" cy="49" rx="3.5" ry="5" fill="#202020" />
          <ellipse cx="81" cy="48" rx="3.5" ry="5.5" fill="#ed3327" />
          <circle cx="60" cy="66" r="2.5" fill="#202020" />
        </>
      )}
    </svg>
  );
}

export const qqSource = (contacts) =>
  contacts
    ?.find((c) => c.type === "QQ" && /^\d{5,12}$/.test(c.value.trim()))
    ?.value.trim();
export function Avatar({
  type = "person",
  contacts,
  qq,
  src,
  name = "",
  size = "normal",
}) {
  const qqNumber = qq || qqSource(contacts);
  const qqUrl =
    type === "person" && /^\d{5,12}$/.test(qqNumber ?? "")
      ? `/__prototype/avatar/qq/${qqNumber}`
      : "";
  const [failed, setFailed] = useState([]);
  const source = [src, qqUrl].find((value) => value && !failed.includes(value));
  return (
    <span
      className={`avatar avatar-${type} avatar-${size}`}
      title={name ? `${name}${source ? "的头像" : " · 默认头像"}` : undefined}
    >
      {source ? (
        <img
          key={source}
          src={source}
          alt={`${name}头像`}
          onError={() =>
            setFailed((previous) => [...new Set([...previous, source])])
          }
        />
      ) : (
        <Placeholder type={type} />
      )}
    </span>
  );
}
