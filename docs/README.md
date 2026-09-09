# 文档导航

当前正式版本 **v0.1.1**，入口为 [scout.dapaidang.org](https://scout.dapaidang.org)。首次上线和后续交付均已完成；功能变化见[更新记录](../CHANGELOG.md)，任务状态以 [GitHub Issues](https://github.com/BreakfastDaPaiDang/commie-talent-scout/issues) 为准。

## 给使用者

| 文档 | 内容 |
| --- | --- |
| [项目介绍](./introduction.md) | 可直接转发的用途、入口和开始方式 |
| [成员上手指南](./member-guide.md) | 登录、查档案、写观察、负责人、标签、材料、提醒与 Agent |
| [更新记录](../CHANGELOG.md) | 当前版本及历次上线能力 |

## 给维护者

| 文档 | 职责 |
| --- | --- |
| [PRD](./PRD.md) | 当前产品范围、权限、默认值与验收基线 |
| [v0.1.1 专题](./releases/0.1.1.md) | 绑定材料规则及本版本交付索引 |
| [领域词汇](../CONTEXT.md) / [ADR](./adr/) | 统一术语与长期架构取舍 |
| [开发说明](./development.md) / [部署与恢复](./operations.md) | 本地运行、检查、发布、备份与运维 |
| [标签系统](./tag-system.md) / [初始词库](./tag-catalog.md) | 公共定义、绑定依据与历史规则；初始词汇 |
| [MCP 使用体验](./mcp-agent-experience.md) / [主题指南](./mcp/agent-guide.md) | 材料整理、主动建议和按授权执行的业务基线 |
| [Agent 接入提示词](./agent-onboarding-prompt.md) | 接入模板、认证与持久连接规则 |
| [MCP 对接设计](./mcp-design.md) / [请求留存](./mcp-request-data.md) | 工具契约、失败恢复与任务审阅 |
| [技术方案](./technical-design.md) | 部署单元、共享业务层、持久化与并发 |
| [设计说明](./design/README.md) / [前端约定](./agents/frontend.md) | 历史设计和共享界面的当前维护要求 |
| [前端原型](../prototypes/frontend/) / [技术验证](./technical-validation.md) | 虚构演示与历史实验，区别于正式运行状态 |
| [首版任务拆解](./implementation-issues.md) | v0.1.0 的 14 项原始业务路径与依赖，保留历史基线 |
| [验收导航](./validation/README.md) | 首次上线及后续功能验证证据 |

## 维护方式

新增需求更新 PRD 或其引用专题，并由 GitHub Issue 跟踪实施与验收。上线后同步更新记录、受影响的成员说明和 GitHub Release。软件版本以根目录 `package.json` 与正式 Release 为准；PRD 修订号、原型及探针包版本不作为产品版本。

历史实验报告保留当时的结果和限制，通过当前导航指向后续结论，不把旧报告改写为后来通过。普通成员的文档只解释使用所需的内容，部署、备份和实现细节留在维护文档。公开证据使用虚构数据，不上传真实档案、内部材料或认证信息。
