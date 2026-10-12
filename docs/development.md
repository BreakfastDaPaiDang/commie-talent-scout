# 正式应用开发与部署

根目录是正式应用；`prototypes/frontend` 和 `spikes/cloudflare-mcp` 分别保留原型与技术验证，不参与正式构建。

首次本地启动：

```powershell
npm ci
npm run setup:demo
npm run build
npm run dev:worker
```

`setup:demo` 只操作本地 Wrangler 的 D1/R2 模拟环境，不需要 Cloudflare 账号，也不会连接 staging 或生产。它会准备虚构的人物、组织、社员、任务、标签、观察记录、评论历史和图片，并在 `secrets/demo-local-accounts.json` 写入本次生成的本地账号与 MCP Token；该文件不会被 Git 跟踪。浏览器打开 `http://127.0.0.1:8790/`，使用脚本输出的 `demo_admin` 登录。需要清空并重建本地演示资料时运行 `npm run setup:demo:reset`。

开发前端时另开 `npm run dev`，使用 `http://127.0.0.1:5190/`，接口代理到 8790。演示账号只属于本地环境，不要复制到 `https://scout-staging.dapaidang.org`；远程 staging 仍按独立账号和凭证验收。旧的 `node scripts/bootstrap.mjs --target staging` 仍可用于只需要空数据库的本地场景，但新开发者优先使用演示初始化。

检查使用 `npm run check`、`npm test`、`npm run test:dom`、`npm run build` 和 `node scripts/check-ui.mjs`；本地演示初始化及 D1/R2 复现检查使用 `npm run test:demo`。真实接口界面验收按 [前端约定](./agents/frontend.md)执行。重新构建后，如果本地 Worker 对新静态文件返回 HTML，请重启 `dev:worker` 使资源索引更新。

档案生命周期规则视图使用 `npm run rules:generate` 从执行定义生成，提交代码时一并提交结果；`npm run rules:check` 检查过期，CI 同样执行。真实网页/MCP 关闭与重开联验使用 `node scripts/verify-archive-lifecycle.mjs`（可加 `--remote` 检查隔离 staging）。新版接入和生产边界见 [1.0.0 集成方案](./releases/1.0.0/integration.md)。

测试环境发布先构建，再运行 `node scripts/release.mjs --env staging`，统一执行备份、迁移、部署与检查。Wrangler 需要本机 Cloudflare 管理授权。生产已由 main 的 GitHub Actions 自动发布，流程见[部署与恢复](./operations.md)；不能把 staging 数据库绑定到生产。

`scripts/verify-auth.mjs` 接受明确的测试 URL 和私有凭证路径，会轮换测试密码并更新私有文件。`verify-auth-boundaries.mjs` 默认本地，加 `--remote` 检查隔离云端；`verify-auth-load.mjs` 仅检查 staging。它们会产生限流计数，避免连续重复运行。报告写入 `tmp/verification`；只将审核后的脱敏证据复制到 `docs/validation`。

MCP 行为检查：`node scripts/verify-mcp.mjs`（本地）或加 `--remote`（staging）。定时任务验证先另开 `npm run dev:scheduled`，再运行 `node scripts/verify-journal.mjs`；专用本地入口使 scheduled 测试中间件优先于 SPA 静态资源，生产未开放测试触发接口。

`node scripts/verify-codex-onboarding.mjs temporary|persistent|unselected` 使用本机已登录的 Codex CLI，在 `secrets/` 中建立隔离的私有客户端目录，验证后撤销应用测试凭证并删除复制的 ChatGPT 登录文件。它不改维护者真正的客户端配置。执行日志只保存到私有目录，不上传完整对话或配置。

观察与草稿验收依次运行 `node scripts/verify-observations.mjs`、`node scripts/verify-drafts.mjs`、`node scripts/verify-observation-boundaries.mjs`，各可加 `--remote`。边界检查复用观察检查创建的虚构冻结作者，并只修改自身到期测试草稿的时间。通用验收客户端在本进程优先 IPv4，写入超时时先查原请求收据，报告单列恢复方式。

正式草稿保存在 D1，按本人/档案隔离、最近保存后保留 30 天，刷新和退出不清除已保存草稿；浏览器只保留当前未保存输入。退出先提交待保存草稿，失败会提示继续处理。阅读位置仅保存在按本人/档案隔离的 sessionStorage，包含滚动位置、已加载页数及当前历史视图，不含观察正文。

标签验收使用 `node scripts/verify-tags.mjs`，可加 `--remote`；只调整自身虚构来源的删除标记和虚构词条定义来验证读取边界，结束恢复来源并冻结测试成员。`node scripts/verify-codex-compression.mjs --remote` 运行六个真实 Codex 冷启动案例，包含只针对一份虚构档案的响应丢失转发器；`verify-compression-web.mjs --remote` 从网页接口独立核对其实际产物。脚本不改维护者的真实客户端配置，测试后撤销凭证并清理复制的登录文件。调用频繁时先考虑已有登录限速，避免重复跑完整套件。

图片与头像验收使用 `node scripts/verify-images.mjs`，可加 `--remote`。`verify-image-boundaries.mjs` 验证 10 MiB、十图、并发引用和清理；本地先开 `npm run dev:scheduled`，云端保留自身清理样例等待真实 cron 后复核。测试只使用 `tests/fixtures/images` 的生成图形；不上传个人照片。QQ 的缓存时间、并发刷新和失败回退通过真实 SQLite 服务测试、替代外部网络响应验证。

`verify-codex-images.mjs --remote` 是完整真实客户端验收脚本，要求该客户端同时具备本地文件读取和 HTTP PUT 能力。早期 S6 曾因隔离 CLI 策略未完成上传；后续真实客户端及网页联验已完成，当前结论见[首次上线验收](./validation/v0.1.0-release-acceptance.md)。重跑条件与逐次确认流程见[部署与恢复](./operations.md)，不为普通文档维护重复执行整套外部模型测试。

本地 Worker 显式使用 `dev.host=127.0.0.1:8790`，避免 Wrangler 把无 Origin 的本地 MCP URL 改写为云端域名。Vite 的同源开发代理涵盖 API、MCP、上传、图片和头像；只对明确的本地开发 Origin 改写上游 Origin。正式页面仍由同域 Worker 提供。

档案阅读验收使用 `node scripts/verify-reading-ui.mjs`，可加 `--remote` 验证隔离 staging。当前覆盖 Issue #36 邮件式阅读；S10 的旧逐条滚动证据仅保留历史含义。阅读边界见 [ADR 0012](./adr/0012-mail-style-archive-reading.md)。

辅助工具页与 MCP QQ 导出指南：运行 `node scripts/verify-auxiliary-tools.mjs`，加 `--remote` 检查云端 staging。脚本仅使用验收连接读取指南与页面，不连接成员 QCE 或导出私人聊天；本地同时核对当前原型共享页面。


### 服务账号验证

迁移 `0030_service_subjects.sql` 创建早纪服务账号，显示在猎头管理，不创建社员档案。早纪使用专用可撤销凭据运行验收，执行用途标记为 verification；不提供普通密码登录。通用验收入口为 scripts/verification-client.mjs，旧开发测试号已冻结。`node scripts/verify-service-subjects.mjs` 在隔离本地库验证账号管理、任务簿、看板、手机端完整头像编辑和真实头像更新，结束时恢复头像并清理本次虚构任务/档案。原始头像为 `public/art/zaoji-hr.png`，不包含凭据或真实人员数据。
