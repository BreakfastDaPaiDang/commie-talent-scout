# #76 人员与组织的关闭历史筛选

日期：2026-10-12。

## 实现与边界

- 外部人物、社员、组织沿用共享筛选栏，默认最近 30 天，可选 90 天或全部。折叠显示当前范围，重置恢复 30 天；选择按页面保留。
- 服务端 `closed_history` 接受 `30`、`90`、`all`，以最后一条 `archive.closed` 事件为准；分页沿用首屏游标时间，避免跨页边界漂移。条件在计数与分页前执行。
- 开启档案不受时间限制；关闭后其他更新不延长展示，再次关闭采用新事件。缺少关闭证据的历史记录只在全部中出现。
- HTTP/MCP 省略参数保持全部历史；网页显式传 30 天，回收站不加时间限制。旧 ID 详情可读，不更改生命周期、来源权限及删除权限。
- 无数据库迁移或生产数据回填；社员字段、灰化打勾及只读问题留待单独设计。

## 验证

- `tests/archive-closed-history.test.mjs`：4 项真实 SQLite 服务测试，覆盖三类范围、10/45/100 天关闭、200 天前更新的开启档案、重开再关、缺失时间、滚动边界、跨页时间固定、搜索/成员/状态/标签/未读组合、删除权限，以及 MCP 兼容。
- `tests/archive-closed-history.dom.test.tsx`：三处列表的默认请求、90 天与全部、摘要、重置、独立偏好及回收站范围。
- `node scripts/verify-archive-closed-history.mjs`：本地真实 HTTP/MCP 一致，三处页面在 1440px 与 390px 验证展开、收起、切换、重置；无浏览器运行错误。合成档案验收后删除，临时 MCP 凭据撤销。
- `node scripts/check-ui.mjs`：历史设计对照、完整展开编辑表单与发布区、卡片、提醒、头像和图片浏览回归通过。
- `node scripts/verify-workspace-ui.mjs`：真实接口的编辑、标签、状态和手机图文发布 6 项通过。
- 类型检查、规则生成校验、构建、服务测试与 DOM 测试通过。

截图与运行日志：本地 `tmp/verification/archive-closed-history/`、`tmp/verification/archive-closed-history-local.json`。截图不作为仓库源码提交。
