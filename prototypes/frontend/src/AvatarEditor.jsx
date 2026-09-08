import React, { useRef, useState } from "react";
import { Avatar } from "./Avatar.jsx";
import { ImageInput, imageFiles } from "./components.jsx";

export function AvatarEditor({
  type = "person",
  name,
  qq,
  contacts,
  value,
  onChange,
  notify,
  label = "头像",
}) {
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  async function choose(files) {
    const image = imageFiles(files.slice(0, 1), notify)[0];
    if (!image) return;
    const sequence = ++request.current;
    setLoading(true);
    const candidate = new Image();
    candidate.src = image.url;
    try {
      await candidate.decode();
      if (sequence === request.current) onChange(image.url);
      else URL.revokeObjectURL(image.url);
    } catch {
      URL.revokeObjectURL(image.url);
      if (sequence === request.current)
        notify("这张图片无法读取，请换一张 PNG、JPEG 或 WebP 图片", "error");
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  }
  return (
    <div
      className="form-avatar"
      onPaste={(event) => {
        if (event.clipboardData.files.length) {
          event.preventDefault();
          choose([...event.clipboardData.files]);
        }
      }}
    >
      <Avatar
        type={type}
        name={name}
        qq={qq}
        contacts={contacts}
        src={value}
        size="large"
      />
      <div className="avatar-editor-controls">
        <strong>{label}</strong>
        <div className="avatar-editor-actions">
          <ImageInput
            multiple={false}
            label={value ? "更换头像" : "上传头像"}
            onFiles={choose}
          />
          {value && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                request.current++;
                setLoading(false);
                onChange("");
              }}
            >
              移除上传头像
            </button>
          )}
        </div>
        <p>
          {loading
            ? "正在读取图片…"
            : type === "org"
              ? "未上传时使用默认组织头像。"
              : "未上传时使用 QQ 或默认头像。"}
        </p>
      </div>
    </div>
  );
}
