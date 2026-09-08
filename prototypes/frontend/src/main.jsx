import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./app.css";
import "./workspace.css";
import "./brand.css";
const sizes = {
  mobile: [390, 844],
  phone: [375, 812],
  tablet: [768, 1024],
  compact: [1024, 768],
  laptop: [1440, 900],
};
const preview = new URLSearchParams(location.search).get("preview");
function ResponsivePreview() {
  const [width, height] = sizes[preview];
  return (
    <main className="responsive-preview">
      <header>
        <a href="/">← 桌面原型</a>
        <span>
          {width} × {height}
        </span>
        <select
          aria-label="预览尺寸"
          value={preview}
          onChange={(event) => {
            location.search = `?preview=${event.target.value}`;
          }}
        >
          {Object.entries(sizes).map(([key, size]) => (
            <option value={key} key={key}>
              {size[0]} × {size[1]}
            </option>
          ))}
        </select>
      </header>
      <iframe src="/?frame=1" title="尺寸预览" width={width} height={height} />
    </main>
  );
}
createRoot(document.getElementById("root")).render(
  sizes[preview] ? <ResponsivePreview /> : <App />,
);
