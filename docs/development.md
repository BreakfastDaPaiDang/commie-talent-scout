# 正式应用开发与部署

根目录是正式应用；`prototypes/frontend` 和 `spikes/cloudflare-mcp` 分别保留原型与技术验证，不参与正式构建。

首次本地启动：

```powershell
npm ci
npx wrangler d1 migrations apply cts-staging --env staging --local
node scripts/bootstrap.mjs --target staging
npm run build
npm run dev:worker
```

浏览器打开 `http://127.0.0.1:8790/`。开发前端时另开 `npm run dev`，使用 `http://127.0.0.1:5190/`，接口代理到 8790。本地初始化凭证保存在 `secrets/bootstrap-staging-local-admin.json`，首次登录必须改密。不要重复初始化已有数据；失败但状态为 pending 时，应先检查数据库和私有恢复文件。

检查使用 `npm run check`、`npm test`、`npm run build`。测试环境部署使用 `npx wrangler d1 migrations apply cts-staging --env staging --remote` 后运行 `npm run deploy:staging`。Wrangler 需要本机 Cloudflare 管理授权。生产与 CI 配置在上线切片完成，不能把 staging 数据库绑定到生产。

`scripts/verify-auth.mjs` 接受明确的测试 URL 和私有凭证路径，会轮换测试密码并更新私有文件。`verify-auth-boundaries.mjs` 默认本地，加 `--remote` 检查隔离云端；`verify-auth-load.mjs` 仅检查 staging。它们会产生限流计数，避免连续重复运行。报告写入 `tmp/verification`；只将审核后的脱敏证据复制到 `docs/validation`。
