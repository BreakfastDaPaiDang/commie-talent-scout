# 独立知识库与资源服务

知识库正式入口为主站 `/knowledge`。普通页与版本协作共用 `app/ui/KnowledgeWorkspace.tsx`，原型入口 `prototypes/frontend/?knowledge` 使用同一组件，加 `&connected` 可连接真实接口。详见 [知识库工作台](../docs/knowledge-workspace.md)、[ADR 0021](../docs/adr/0021-knowledge-branches-and-consensus.md) 和 [Issue #145](https://github.com/BreakfastDaPaiDang/commie-talent-scout/issues/145)。

## 服务边界

`commie-knowledge-staging` 与 `commie-knowledge-production` 分别使用独立 Cloudflare D1。知识正文、不可变版本、分支、同意、议题、分类定义、评论、资源及糖果授权都保存在知识库数据库。知识服务没有主站 D1 绑定；通过 `IDENTITY` 服务绑定核验主站身份。主站通过 `CATALOG` 服务绑定代理请求，不复制知识内容到人事数据库。

正式成员可读写；糖果授权接收者只读主分支和资源目录，不获得人事档案权限。旧私人草稿只对原作者可见，作者明确共享后才能提出合并请求。初始材料仅作为私人参考稿导入，不自动公开、投票或合并。

## 共识规则

- 主分支 `main` 提供只读的当前共识。文档新增、修改或移除逐篇进入审核。
- 同一版本在七天内取得三名不同正式成员明确同意才具备合入资格。截止后已达标的候选可继续处理。修改或未达标过期后重提开启新一轮并保留旧票历史。
- 通过 `/reviews` 提交的单篇候选在第三票时检查冲突和同篇的其他有效候选。没有这两项时随本票合入。版本协作的合并请求保留显式合入。同一篇文档的多个达标候选需要记录会议或议题选择。
- 合入前用与主分支的共同基础检查冲突。处理冲突后重新征求同意。
- 知识标签的新增和改写独立提议，七天内取得三票后生效。网页成员可以给文档附加待认可的标签。MCP、连接令牌和糖果接收者的读取仅返回已认可标签。
- 普通评论显示在文末；批注保存版本、原句和字符范围，显示在句下。正文变化后仅在唯一定位成功时重新附着，否则保留为旧版本批注。

## 接口

主站会话通过同源 `/api/knowledge-workspace/*` 使用知识服务；个人连接可使用 `Authorization: Bearer <本人连接>`。糖果链接使用片段交换 HttpOnly Cookie，片段随后移除。身份在每次请求重新核验；权限失效或身份服务故障阻止继续访问。

| 路径（前缀 `/api/knowledge-workspace`） | 用途 |
|---|---|
| `/branches`、`/branches/share` | 分支与私人草稿共享 |
| `/documents`、`/documents/:id`、`/documents/remove` | 搜索、分页、不可变版本写入与移除 |
| `/categories`、`/categories/definition` | 当前分支标签及定义 |
| `/tag-proposals`、`/tag-proposals/approve` | 网页查看和认可标签提议 |
| `/diff`、`/branches/resolve` | 与主分支比较、明确解决冲突 |
| `/reviews` | 单篇文档审核，含旧批量候选中的单篇文档 |
| `/merges`、`/merges/approve`、`/merges/accept` | 合并请求、同意与执行合入 |
| `/issues`、`/issues/:id`、`/issues/state` | 独立议题、结论及候选选择 |
| `/comments` | 文末评论、句下批注、类别和议题讨论 |
| `/history`、`/history/:id` | 当前分支可达的历史提交和具体变更 |
| `/requests/:id` | 查询本人的幂等请求结果 |

所有写操作提供 UUID `request_id`，失败重试保持参数与 ID。分支和主分支版本检查与全库修订守卫在同一 D1 事务提交，防止并发静默覆盖；响应丢失可通过回执恢复。网页与主站／独立服务 MCP 共用业务服务，不提供快捷采纳接口。

Agent 先读 `knowledge_workspace_guide`，再用 `knowledge_documents` 读取 `main`，按 `next_offset` 逐页读取。每页核对 `branch.head_id` 和 `tag_revision`，继续业务前再次核对。任一值变化或收到 `KNOWLEDGE_SNAPSHOT_CHANGED` 时从第一页开始。标签认可可能单独改变 `tag_revision`。通过 MCP 保存文档可以省略 `category`，已有标签关联继续保留。MCP 标签提议返回提交确认，正式成员在网页查看并认可。

资源目录保留 `/api/catalog` 及相应 MCP 工具。旧 `/api/entries` 提供历史兼容读取，旧写接口返回 410。权威切换见 [ADR 0020](../docs/adr/0020-production-resource-authority.md)。

## 本地与发布

```sh
npm run knowledge:check
npm run knowledge:test
npm run knowledge:build
npm run build
node --experimental-transform-types scripts/verify-knowledge-workspace.mjs
```

浏览器验收使用虚构数据和两个独立 SQLite 数据库，通过主站真实 HTTP 代理访问知识服务。覆盖桌面、手机完整编辑、同意／合并、评论、选择批注、分类侧栏及共享原型对照。输出在 `tmp/verification/knowledge-workspace/`，不会写生产数据。

`knowledge.yml` 负责独立服务检查与发布；主站发布完成身份桥接后，分别备份、迁移、部署和验证测试与正式知识库。固定数据库名称及主站数据库排除清单阻止误用人事库；实际 ID 与部署版本进入流程摘要，SQL 备份仅进入既有私有桶。部署代码失败保留可回滚版本，迁移为兼容性扩展。

首次附录导入通过私有 CI 输入，幂等写入私人分支；既有文档不覆写、不重新挂回。正文、连接令牌及密码不得进入公开源码、迁移、日志或 URL 查询参数。培养实训和完整组织宪法不在本轮范围。
