import { defineConfig } from "vite";
import https from "node:https";

// Local prototype helper only. Production uses authenticated entity/member IDs.
// Fixed upstream and bounded response: user input cannot choose a URL or host.
const cache = new Map();
function qqAvatarPlugin() {
  return {
    name: "prototype-qq-avatar",
    configureServer(server) {
      server.middlewares.use("/__prototype/avatar/qq/", (req, res) => {
        const qq = (req.url ?? "").split("?")[0].replace(/^\//, "");
        if (!/^\d{5,12}$/.test(qq)) {
          res.writeHead(400);
          res.end();
          return;
        }
        const send = (entry) => {
          res.writeHead(200, {
            "Content-Type": entry.type,
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
          });
          res.end(entry.bytes);
        };
        const old = cache.get(qq);
        if (old && Date.now() - old.at < 86400000) {
          send(old);
          return;
        }
        const upstream = https.get(
          `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`,
          { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 5000 },
          (response) => {
            const type = (response.headers["content-type"] ?? "").split(";")[0];
            if (
              response.statusCode !== 200 ||
              !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
                type,
              )
            ) {
              response.resume();
              if (old) send(old);
              else {
                res.writeHead(502);
                res.end();
              }
              return;
            }
            let size = 0;
            const chunks = [];
            response.on("data", (chunk) => {
              size += chunk.length;
              if (size > 2 * 1024 * 1024) {
                upstream.destroy(new Error("oversized avatar"));
                return;
              }
              chunks.push(chunk);
            });
            response.on("end", () => {
              if (res.writableEnded) return;
              const entry = {
                bytes: Buffer.concat(chunks),
                type,
                at: Date.now(),
              };
              if (cache.size >= 100) cache.delete(cache.keys().next().value);
              cache.set(qq, entry);
              send(entry);
            });
          },
        );
        upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
        upstream.on("error", () => {
          if (res.writableEnded) return;
          if (old) send(old);
          else {
            res.writeHead(502);
            res.end();
          }
        });
      });
    },
  };
}
export default defineConfig({ resolve: { dedupe: ["react", "react-dom"] }, plugins: [qqAvatarPlugin()] });
