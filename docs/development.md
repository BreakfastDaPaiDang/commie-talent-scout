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

MCP 行为检查：`node scripts/verify-mcp.mjs`（本地）或加 `--remote`（staging）。定时任务验证先另开 `npm run dev:scheduled`，再运行 `node scripts/verify-journal.mjs`；专用本地入口使 scheduled 测试中间件优先于 SPA 静态资源，生产未开放测试触发接口。

`node scripts/verify-codex-onboarding.mjs temporary|persistent|unselected` 使用本机已登录的 Codex CLI，在 `secrets/` 中建立隔离的私有客户端目录，验证后撤销应用测试凭证并删除复制的 ChatGPT 登录文件。它不改维护者真正的客户端配置。执行日志只保存到私有目录，不上传完整对话或配置。

观察与草稿验收依次运行 `node scripts/verify-observations.mjs`、`node scripts/verify-drafts.mjs`、`node scripts/verify-observation-boundaries.mjs`，各可加 `--remote`。边界检查复用观察检查创建的虚构冻结作者，并只修改自身到期测试草稿的时间。通用验收客户端在本进程优先 IPv4，写入超时时先查原请求收据，报告单列恢复方式。

正式草稿保存在 D1，按本人/档案隔离、最近保存后保留 30 天，刷新和退出不清除已保存草稿；浏览器只保留当前未保存输入。退出先提交待保存草稿，失败会提示继续处理。阅读位置仅保存在按本人/档案隔离的 sessionStorage，包含滚动位置、已加载页数及当前历史视图，不含观察正文。
