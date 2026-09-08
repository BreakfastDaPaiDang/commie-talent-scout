# 康米巨星猎头系统

`commie-talent-scout` 是早餐社内部使用的人物与组织观察档案、接触进度和协作记录系统。

正式首版定为 **v0.1.0**，见 [里程碑](https://github.com/BreakfastDaPaiDang/commie-talent-scout/milestone/1)。PRD 文档修订 1.6 包含标签、材料压缩、持久 MCP 接入与请求留存。已有技术验证与前端原型，正式应用尚未实现或上线。

本地查看：在 `prototypes/frontend` 执行 `npm ci`、`npm run dev`，打开 http://127.0.0.1:5181/ 。原型仅含虚构数据，刷新复位。

- [文档导航与实施基线](./docs/README.md)：版本、各文档职责和实现状态。
- [前端原型](./prototypes/frontend/)：人物、组织、记录、登录、账号与 Agent 接入页面。
- [第四版设计与资产](./docs/design/README.md)：品牌与登录、阅读字号、头像优先级、Assembly 排版和连续工作体验。
- [技术验证](./docs/technical-validation.md) / [技术方案](./docs/technical-design.md)：云端、真实 Codex 和大陆网络证据及实施边界。
- [GitHub 实施任务](./docs/implementation-issues.md)：已发布 #1–#14，包含验收路径、依赖及 v0.1.0 里程碑映射。
- [PRD](./docs/PRD.md)：首版范围、业务规则、默认值与验收要求。
- [标签系统](./docs/tag-system.md) / [初始标签库](./docs/tag-catalog.md)：人物与组织的特征整理、绑定依据、修改影响和 MCP 标签维护；尚未实现。
- [领域词汇表](./CONTEXT.md)：统一领域术语。
- [决策记录](./docs/adr/)：重要取舍及其原因。
- [Agent 接入提示词](./docs/agent-onboarding-prompt.md)：接入页共用短模板，包含临时/持久配置选择。
- [MCP 的 Agent 使用体验](./docs/mcp-agent-experience.md)：把聊天等材料压缩为观察与标签；[请求留存](./docs/mcp-request-data.md)用于根据实际使用优化。

## 计划能力

- 人物与组织档案、状态与成员绑定；工作状态必须指定负责人，其他状态可选关联。
- 图文观察记录、修改历史和实体动态时间线。
- 人物/组织独立标签库、类别与描述、绑定依据、重点展示和标签筛选。
- 档案关闭后锁定内容，重新开启后继续维护。
- 账号密码登录、成员权限和管理员账号后台。
- MCP 接入，让 Agent 在对应成员的权限下执行操作。
- 优先使用 Cloudflare serverless，后续配置 GitHub 更新自动部署。

## 数据与配置

本仓库公开维护源码和项目文档，应用中的档案与记录仅供登录成员访问。

真实档案、观察记录、上传图片、账号数据、数据库文件、备份和凭证不进入仓库。运行时数据由独立存储保存，环境配置与密钥通过本地环境或部署平台管理。

`.gitignore` 提供常见文件的排除规则，提交前仍需检查暂存内容。配置示例只能使用占位值，演示数据只能使用虚构内容。

2026-09-08 第四版原型：新星形 Logo 与登录插画，登录只保留必要内容；列表区分上方负责人/关联和下方观察条数；人物与猎头账号头像按上传图、QQ、默认图回退，正文及辅助字号整体提高。入口改称“猎头账号”和“猎头管理”。详见 [本轮设计](./docs/design/README.md)及[品牌资产](./docs/design/v4/README.md)。数据仍为虚构内存演示；后续需求以当前 PRD 与任务草稿为准。
