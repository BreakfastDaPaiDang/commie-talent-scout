import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./app.css";
function ResponsivePreview() {
  return (
    <main className="responsive-preview">
      <header>
        <a href="/">← 桌面原型</a>
        <span>窄屏预览 · 390 × 844</span>
      </header>
      <iframe src="/?frame=1" title="手机原型" width="390" height="844" />
    </main>
  );
}
createRoot(document.getElementById("root")).render(
  new URLSearchParams(location.search).get("preview") === "mobile" ? (
    <ResponsivePreview />
  ) : (
    <App />
  ),
);
