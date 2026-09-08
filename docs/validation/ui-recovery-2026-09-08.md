# 正式页面对齐与连续动态修正

对应 [Issue #15](https://github.com/BreakfastDaPaiDang/commie-talent-scout/issues/15)，关联 #7、#10。2026-09-08 用户反馈后修正，采用用户明确允许的接口与模拟浏览器验证方式。

正式组件使用 archive-* 结构，原型样式主要作用于 entity-* / detail-inner 等结构，导致此前虽然复制了样式，关键布局并未应用。此次接回已确认 Assembly 结构：紧凑列表头、名称与状态同行、头像置右、成员和联系方式行内排列、动态页签在输入框上方、1040px 内容列以及 21px / 移动 19px 正文。标签统一白底、灰线、直角，类别颜色只作细边提示。正式页面仍包含搜索、未读等真实功能，没有修改原型源文件。

五分钟分组按同档案、同成员、相邻事件和单组最大时间跨度计算，跨页加载后在客户端重新分组；不会因持续操作无限延长一组。观察正文保留显示，附带操作默认一条摘要，展开后挂载原始明细。接口返回 activity_groups，同时完整保留 events；分组发生在可见性过滤之后。未读队列保留原始事件位置与阅读状态，采用同样的紧凑展示。

验证：

- 类型检查通过，17 项服务/纯函数测试通过；新增边界覆盖五分钟整点、超过窗口、不同成员/档案、非法时间与分页追加。
- `npm run test:dom` 三项通过。挂载实际 React 组件，验证原型结构；模拟视野外、后台、弹窗遮挡、失败自动重试；分组收起时只有正文阅读边界，展开后才挂载操作明细阅读边界。
- `scripts/verify-reading-search.mjs` 本地和云端各五组通过；增加真实 Web/MCP 分组一致性、完整事件保留、摘要不确认、隐藏标签事件不进入分组 ID。云端完成于 2026-09-08T15:57:14Z，未发生结果不明恢复；[脱敏结果](./ui-recovery-protocol-cloud.json)。
- 生产构建通过。本地 8790 与云端返回的 CSS 内容与此次构建逐字相同，资源为 `index-CLRbgHYd.css`；用完整构建 CSS 在 jsdom 中计算标签样式，结果白底 `rgb(255, 255, 255)`、圆角 `0px`。可用 `node scripts/verify-workspace-assets.mjs` / `--remote` 复验。

jsdom 不执行实际页面排版绘制；以上为 DOM、状态与接口验证，不能写成像素截图或实际滚动绘制验收。用户已允许非视觉行为以模拟浏览器环境验证，不再将浏览器控制恢复作为这类测试的前置条件。原 Codex 客户端图像和删除链路的失败仍单独保留，不用协议套件替代实际客户端通过证明。

权限诊断：图片实验的隔离 CODEX_HOME 仅复制 model / model_reasoning_effort，未带入本机 Windows sandbox 配置，并固定只读沙箱，且缺少文件读取/上传能力的前置检查；这是测试设计和配置覆盖不足。`blocked by policy` 记录没有更细的原因，不能断言只读沙箱必然禁止读图，也不能断言已修复。删除实验明确返回 `MCP tool call requires approval, but approval policy is never`，属于审批策略和所需确认冲突。没有降低 MCP destructiveHint 或修改当前会话审批策略绕过拒绝。[官方审批与安全说明](https://learn.chatgpt.com/docs/agent-approvals-security)区分沙箱能力与审批策略，二者需要分别核对。

隔离测试站部署：`eaeaab30-dc14-4767-97bb-413ccc0b2271`，<https://scout-staging.dapaidang.org>。生产未发布。
