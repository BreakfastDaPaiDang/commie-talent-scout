import React, {
  createContext,
  useContext,
  useId,
  useRef,
  useEffect,
} from "react";
import { Icon, Mark } from "./icons.jsx";
import { Placeholder } from "./Avatar.jsx";

export function Button({
  children,
  icon,
  variant = "",
  className = "",
  ...props
}) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </button>
  );
}
export function IconButton({ name, label, ...props }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      <Icon name={name} />
    </button>
  );
}
export const FeedbackContext = createContext(null);
export function Feedback({ toast, inline = false }) {
  if (!toast) return null;
  return (
    <div
      className={`${inline ? "dialog-feedback" : "toast"} ${toast.tone}`}
      role={toast.tone === "error" ? "alert" : "status"}
      key={toast.id}
    >
      <Icon name={toast.tone === "error" ? "info" : "check"} />
      <span>{toast.message}</span>
    </div>
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  const toast = useContext(FeedbackContext);
  const backdropPress = useRef(false);
  const outside = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return (
      e.target === e.currentTarget &&
      (e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom)
    );
  };
  useEffect(() => {
    const trigger = document.activeElement;
    ref.current?.showModal();
    ref.current
      ?.querySelector(
        'input:not([type="file"]):not([type="hidden"]), textarea, select',
      )
      ?.focus({ preventScroll: true });
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(e) => {
        backdropPress.current = outside(e);
      }}
      onClick={(e) => {
        if (backdropPress.current && outside(e)) onClose();
      }}
    >
      <div className="modal-chrome">
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton name="close" label="关闭对话框" onClick={onClose} />
        </header>
        <Feedback toast={toast} inline />
      </div>
      {children}
    </dialog>
  );
}
export function Empty({ type = "person", title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-character">
        <Placeholder type={type} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function ImageInput({ onFiles, label = "添加图片", multiple = true }) {
  const ref = useRef(null);
  return (
    <>
      <input
        ref={ref}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple={multiple}
        onChange={(e) => {
          onFiles([...e.target.files]);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="quiet"
        icon="image"
        onClick={() => ref.current?.click()}
      >
        {label}
      </Button>
    </>
  );
}
export function imageFiles(files, notify) {
  const accepted = files.filter(
    (f) =>
      ["image/png", "image/jpeg", "image/webp"].includes(f.type) &&
      f.size <= 10 * 1024 * 1024,
  );
  if (accepted.length !== files.length)
    notify("图片需为 PNG、JPEG 或 WebP，单张不超过 10 MB", "error");
  return accepted.map((f) => ({ url: URL.createObjectURL(f), name: f.name }));
}
export function Images({ images, onOpen, onRemove }) {
  return (
    !!images?.length && (
      <div className={`image-strip ${onRemove ? "editable" : ""}`}>
        {images.map((im, i) => (
          <div key={im.url} className="image-tile">
            <button
              type="button"
              aria-label={`查看图片：${im.name}`}
              onClick={() => onOpen?.(im)}
            >
              <img src={im.url} alt={im.name} />
            </button>
            {onRemove && (
              <button
                type="button"
                className="image-remove"
                aria-label={`移除图片${i + 1}`}
                onClick={() => onRemove(i)}
              >
                <Icon name="close" size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
    )
  );
}

export function ReadBoundary({
  token,
  enabled,
  paused,
  onRead,
  children,
  id,
  highlighted,
}) {
  const ref = useRef(null),
    callback = useRef(onRead);
  callback.current = onRead;
  useEffect(() => {
    if (!enabled || paused) return;
    let visible = false,
      timer,
      done = false;
    const schedule = () => {
      clearTimeout(timer);
      if (visible && !document.hidden && !done)
        timer = setTimeout(() => {
          done = true;
          callback.current(token);
        }, 650);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        schedule();
      },
      { threshold: 1 },
    );
    observer.observe(ref.current);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [token, enabled, paused]);
  return (
    <div
      className={`read-boundary ${highlighted ? "entry-target" : ""}`}
      id={id}
      tabIndex={-1}
    >
      <span className="read-sentinel" ref={ref} />
      {children}
    </div>
  );
}

export function Login({ onLogin }) {
  return (
    <div className="login-page">
      <section className="login-scene" aria-hidden="true">
        <img src="/art/login-observatory-v4.png" alt="" />
      </section>
      <main className="login-form">
        <a href="/" className="login-brand">
          <Mark />
          <span>
            康米巨星<small>猎头系统</small>
          </span>
        </a>
        <form
          aria-label="登录"
          onSubmit={(e) => {
            e.preventDefault();
            onLogin();
          }}
        >
          <label>
            猎头账号
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            密码
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          <Button type="submit" variant="primary">
            登录
            <Icon name="arrow" />
          </Button>
        </form>
        <p className="prototype-note">原型预览，任意非空账号和密码可进入。</p>
      </main>
    </div>
  );
}
