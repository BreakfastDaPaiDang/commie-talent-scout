# 任务名称与导航位置修正

2026-11-19，关联 #165，基于 main `d6446f9`。

## 交付范围

- 正式站导航及任务页标题由“待办”改回“任务”。
- 主导航顺序：外部人物、组织、任务、社员、统计、知识库；任务固定第 3 位。
- 知识库共享预览同步导航顺序。六色主页原有“任务”名称保持一致。
- 登录后默认仍打开任务工作台；`/tasks`、历史分享链接、任务状态、期限、负责人、交付规则和列表优先级不变。

## 验证

- 类型检查、构建、架构边界及业务规则生成一致性通过。
- 272 项主站服务测试、40 项 DOM 测试通过。
- `node scripts/check-ui.mjs` 通过：冻结历史原型 `531ab51` 与当前原型、正式构建在 1920／1440／1024／390px 无未授权几何差异；完整编辑、发布、图片阅读等回归通过。
- `node --experimental-transform-types scripts/verify-whale-home-live.mjs` 通过：真实 HTTP、隔离 SQLite 双数据库、1440／390／320px 日夜模式导航顺序、任务高亮与标题；1440／320px 知识库预览导航；主页入口、旧档案链接、完整编辑、实际保存和观察发布。
- 前端源码 `app/client/`、`app/ui/`、`prototypes/frontend/src/` 中已无“待办”文案。

独立工作区安装锁定依赖后完成历史原型验证，未混入原工作区的其他改动。真实 HTTP 脚本的原型服务器补齐正式构建已使用的 PDF 资源插件，使原型入口也参与验证。

机器报告位于 `tmp/verification/whale-home-live/report.json`、`tmp/verification/design-parity/` 及其他同名界面回归目录。

- [桌面任务页](screenshots/task-navigation-165/desktop.png)
- [320px 夜间任务页](screenshots/task-navigation-165/mobile-night.png)
- [320px 知识库预览](screenshots/task-navigation-165/prototype-mobile.png)

合并发布后在 GitHub Issue 记录实际结果；本文件不代替业务交付确认。
