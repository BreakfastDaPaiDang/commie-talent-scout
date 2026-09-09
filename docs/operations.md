# 部署与恢复

应用版本为 0.1.0；GitHub Release 必须等 Issue #14 和首版里程碑验收通过后再建立。

## 环境与数据边界

| 用途 | 域名 / 资源 |
|---|---|
| 正式站 | `https://scout.dapaidang.org`，Worker `cts-web`，D1 `cts-production`，R2 `cts-production-images` |
| 隔离测试站 | `https://scout-staging.dapaidang.org`，Worker `cts-web-staging`，D1 `cts-staging`，R2 `cts-staging-images` |
| 私有备份 | R2 `cts-private-backups`，禁止公开访问 |
| 本次恢复演练 | D1 `cts-restore-20260909`，R2 `cts-restore-20260909-images`，不挂载公开 Worker |

资源标识不是访问凭证。`secrets/`、`backups/`、`tmp/` 和 `.wrangler/` 均不提交。禁止把原始 SQL、账号、令牌、图片、调用正文或原始 Wrangler 输出上传到公开仓库 / Actions artifacts。D1 export 的 CLI 输出可能包含临时下载凭证，因此运维脚本只打印计数和状态。

## 发布

GitHub 的 `Checks and production release` 在 PR 执行检查；main 检查通过后在 production 环境执行发布。检查包括类型、迁移清单、服务测试、DOM 测试、构建、四宽度历史原型对照及展开编辑/手机/卡片/标签体验。Actions 固定到审核过的完整提交 SHA，checkout 不持久化 Git 凭证。

发布与每日备份共用 `cts-production-operations` 锁，禁用取消正在执行的操作。CI 使用独立 `CLOUDFLARE_API_TOKEN`，不复用本机 Wrangler OAuth。2026-09-09 已在 GitHub `production` environment 配置专用账户令牌；自动发布与每日备份/用量工作流均实际运行成功。

令牌仅包含账户 `370c0a6a58a36a7e781de20d1a257ac2` 的 Workers Scripts 编辑、D1 编辑、Workers R2 Storage 编辑，以及 `dapaidang.org` 的 Zone 读取、Workers Routes 编辑。Cloudflare 页面可能把编辑显示为 Write；不添加账号令牌管理、DNS 全局修改或其他项目权限。这些账户级权限并非单 Worker 隔离；如需进一步收窄，应使用专用账户或拆分按桶令牌。参考 [Cloudflare GitHub Actions 配置](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、[API 权限](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)及 [R2 认证](https://developers.cloudflare.com/r2/api/tokens/)。

本机授权登录后可执行：

```sh
npm run check
npm test
npm run test:dom
npm run build
node scripts/check-ui.mjs
node scripts/release.mjs --env production
```

`release.mjs` 校验清单与已发布哈希 → 私有备份 → 兼容迁移 → Worker 部署 → 检查健康、首页安全头、真实静态资源字节、三个私有入口和实际 D1 登录路径 → 写入私有发布记录。部署后任一步失败会回退到上一个代码版本并重新检查服务；不清数据库。可在 `releases/production/latest.json` 查阅最后成功版本。

安全头同时配置于 Worker 中间件和 `public/_headers`，因为默认静态资源不经过 Worker。参考 [Workers 静态响应头规则](https://developers.cloudflare.com/workers/static-assets/headers/)。

## 真实 Codex 客户端验收

`node scripts/verify-codex-images.mjs --remote` 和 `node scripts/verify-codex-observation-state.mjs --remote` 使用本机已登录 Codex 的 app-server，在独立临时客户端中连接 staging。两者保留只读沙箱及逐次确认，启动前先核验 MCP 工具已加载；不使用非交互 `exec` 的默认拒绝来代替验收。

客户端打印 `human_input_required` 时，操作员应查看其指向的私有 `*-pending.json`，向用户展示实际命令或工具、目标及影响，等待用户答复。只可将用户明确批准的请求写入相邻 `*-reply.json`：`id` 必须匹配未完成请求，`human_confirmed: true` 表示已收到用户确认，`result` 使用本机 Codex 生成协议中的响应结构。取消或拒绝可直接响应；不得按超时自动批准，亦不得把一次批准转换为会话或永久授权。

原始请求、临时认证和调用结果仅保存在已排除提交的 `secrets/`；结束时撤销测试连接并清除复制的认证信息。每次收到有效答复后重置客户端超时计时。删除已提交而客户端超时时，可使用 `--resume-after-delete <私有恢复文件>` 核对原成功收据再续验恢复；上传尚未发布时可使用 `--resume-upload <私有恢复文件>` 复用同一空档案。两者只接受 `secrets/` 内的文件，不以重新写入掩盖中断。

图片两轮成功后执行 `node scripts/verify-codex-images-web.mjs --remote`，在独立无界面浏览器中检查同一条 Codex 记录的当前图片、手机历史图和原图。只有完整业务断言通过才算验收成功，收到确认框或列出工具不算通过。

## 备份与恢复

```sh
node scripts/backup.mjs --env production
node --experimental-transform-types scripts/restore.mjs --snapshot snapshots/production/<snapshot-id>
```

先创建一个新的空 `cts-restore-*` D1 与私有图片桶，再修改 `release.config.json` 的 recovery 项。脚本拒绝覆盖非空目标、生产 / staging 资源或备份桶；失败后应排查并配置新的空目标，不能清空运行中的数据库重试。

快照 SQL 解压上限为 128 MiB，超过时发布会停止，须扩展并审核备份实现再上线。清单完整性检查、全部表的规范化哈希、每个图片对象的 SHA-256、恢复后的 30/180 天请求数据清理都通过后，才可另行切换业务绑定。本次演练还验证了清理事务失败回滚、重复清理和匿名统计不重复累计。D1 自带 [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) 可作为另外的恢复来源，不能替代图片引用核对。

备份桶生命周期只清理 `snapshots/` 下超过 30 天的对象，保留默认的 7 天未完成分片清理；`images/` 内容块和 `releases/` 不自动过期。图片块会随历史增长，需关注容量，不可直接按创建时间删除。

## 日常检查与费用

`Private backup and usage checks` 每日北京时间 03:43 运行，可手动触发。即使备份失败也运行用量检查，任一失败使工作流失败。GitHub 的失败通知遵循维护者个人的 Actions 通知设置；未另行发送邮件或聊天通知。

当前早期阈值：最近 24 小时 MCP 调用 10,000 次、新上传索引字节 1 GiB、就绪图片索引总量 5 GiB、D1 512 MiB。阈值和结果显示在工作流摘要；采集失败不能显示为正常。图片数值来自应用索引，含已删除业务仍保留的历史引用，不代表 R2 账单容量。

这些是运行用量告警，不是实际账单告警，也不是每月 10 美元的硬性消费上限。Worker CPU 上限为每次 2,000 ms，采样日志为 10%，查询参数脱敏；Cloudflare 账单提醒尚须在有权限的账户设置中完成并验证。

## 开发测试身份与回收数据

用户指定 production 的 `admin`（开发 Agent 专用测试号）供开发与验收使用，首次改密已完成。私有凭据保存于本机忽略的 `secrets/development-test-admin.json`；不得写入提交、Issue、截图或日志。日常开发优先使用隔离 staging，生产验收使用该测试号。

档案删除和账号冻结均保留业务历史，不触发图片清理。档案回收功能启用后，不应手动回退到尚未识别 `archives.deleted` 的旧版本，否则旧列表会重新显示回收内容；需要修复时在支持该权限模型的版本上前滚。首次部署该功能完成冒烟后再进行生产删除验收。
