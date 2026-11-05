# 人事交付联动验收（Issue #98）

日期：2026-11-05。范围：本地代码及隔离 Wrangler D1/R2，未部署 staging 或生产。需求见 [Issue #98](https://github.com/BreakfastDaPaiDang/commie-talent-scout/issues/98) 与 [PRD §6.4](../PRD-1.0.0.md#64-完成与交付)。

## 结果

负责人提交 `audit_passed` 后，无额外审批，在同一 `command` 事务中完成审核、推进原档案到待对接并创建一项 P1、待领取、默认七天期限的对接任务。提交 `onboarding_completed` 后，同一档案转入社员，默认可接工作并保持开启。沿用原交付弹窗与观察选择，增加明确结论与影响提示，不预选通过；图形化另行实施。

自动任务来源与 kind 决定适用性，标签不驱动身份；普通任务和旧通用结果不推断通过。提前推进不回退、不重置请假等已有基本状态、不重复创建；退出阶段与旧轮次任务拒绝推进。任务、档案、后续任务、历史和收据一起成功或回滚。

## 检查

- `npm run check`、`npm run build`：通过。
- `npm test`：198 项通过，含 18 项新增人事联动测试，覆盖 web/MCP、明确/非明确结论、观察引用、旧任务重开、重复提交、过时轮次、SQL 失败及事务内版本/关闭/删除/冻结/凭据撤销/责任变化。
- `npm run test:dom`：36 项通过，含审核/对接完整交付的显式结论、影响提示、空引用阻止和观察版本提交。
- `node scripts/verify-personnel-delivery.mjs`：5 组真实本地接口检查通过；1440px 与 390px 分别完整操作审核与对接弹窗，回读同一档案身份及任务；额外验证 MCP 审核、HTTP 对接、幂等重放和未联系到不推进。
- `node scripts/verify-workspace-ui.mjs`：6 组通过，包含真实档案编辑、状态与图文发布。
- `node scripts/verify-task-reference-picker.mjs`：3 组通过，覆盖桌面/手机完整观察选择、HTTP/MCP 空引用拒绝、多选与版本回读。
- `node scripts/check-ui.mjs`：历史原型与当前原型/正式构建对照、完整编辑/发布、四种宽度、卡片、注意力、头像和图片查看回归通过。
- 已人工查看桌面审核交付及手机对接提交截图，结论、影响、结果说明、引用和提交按钮完整，无横向溢出；截图位于本地 `tmp/verification/personnel-delivery-*`。

真实接口检查仅使用虚构本地数据，结束后删除本次档案并撤销对应验收连接。验证报告位于 `tmp/verification/personnel-delivery-local.json`，没有上传内部资料或凭据。使用已有本地管理员为早纪建立了私有验收凭据，保留于忽略跟踪的 `secrets/`，不进入仓库。
