# 独立知识库与资源服务

知识库正式入口为主站 `/knowledge`；简化与 Git（繁）共用 `app/ui/KnowledgeWorkspace.tsx`。原型入口 `prototypes/frontend/?knowledge` 使用同一组件；加 `&connected` 可连接真实接口。当前需求以 [知识库工作台](../docs/knowledge-workspace.md) 和 [ADR 0021](../docs/adr/0021-knowledge-branches-and-consensus.md) 为准，关联 [Issue #145](https://github.com/BreakfastDaPaiDang/commie-talent-scout/issues/145)。

## 服务边界

`commie-knowledge-staging` 与 `commie-knowledge-production` 分别使用独立 Cloudflare D1。知识正文、不可变版本、分支、同意、议题、分类定义、评论、资源及糖果授权都保存在知识库数据库。知识服务没有主站 D1 绑定；通过 `IDENTITY` 服务绑定核验主站身份。主站通过 `CATALOG` 服务绑定代理请求，不复制知识内容到人事数据库。

正式成员可读写；糖果授权接收者只读主分支和资源目录，不获得人事档案权限。旧私人草稿只对原作者可见，作者明确共享后才能提出合并请求。初始材料仅作为私人参考稿导入，不自动公开、投票或合并。

## 共识规则

- 主分支 `main` 是当前共识，不能直接写入。新增或修改先进入分支。
- 至少三名不同正式成员明确同意同一提交，才具备合入资格。作者没有自动票，管理员没有绕过门槛的权限。无七天到期；修改后需对新提交重新同意，旧票保留为历史。
- 达标不自动合并。明确执行合并时，若多个候选达标，必须记录会议结论或引用已结论的议题选择；未选中的候选继续保留。候选集合变化后，旧议题选择不能直接复用。
- 合并使用共同基础检查冲突；冲突先在分支解决，再重新征求同意，不静默覆盖主分支。
- 分类可以自建，随当前分支中的实际文档显示。最后一篇文档移除后分类消失，历史引用保留。分类定义与留言通过临时侧栏打开。
- 普通评论显示在文末；批注保存版本、原句和字符范围，显示在句下。正文变化后仅在唯一定位成功时重新附着，否则保留为旧版本批注。

## 接口

主站会话通过同源 `/api/knowledge-workspace/*` 使用知识服务；个人连接可使用 `Authorization: Bearer <本人连接>`。糖果链接使用片段交换 HttpOnly Cookie，片段随后移除。身份在每次请求重新核验；权限失效或身份服务故障阻止继续访问。

| 路径（前缀 `/api/knowledge-workspace`） | 用途 |
|---|---|
| `/branches`、`/branches/share` | 分支与私人草稿共享 |
| `/documents`、`/documents/:id`、`/documents/remove` | 搜索、分页、不可变版本写入与移除 |
| `/categories`、`/categories/definition` | 当前分支分类及定义 |
| `/diff`、`/branches/resolve` | 与主分支比较、明确解决冲突 |
| `/merges`、`/merges/approve`、`/merges/accept` | 合并请求、同意与执行合入 |
| `/issues`、`/issues/:id`、`/issues/state` | 独立议题、结论及候选选择 |
| `/comments` | 文末评论、句下批注、类别和议题讨论 |
| `/history`、`/history/:id` | 当前分支可达的历史提交和具体变更 |
| `/requests/:id` | 查询本人的幂等请求结果 |

所有写操作提供 UUID `request_id`，失败重试保持参数与 ID。分支和主分支版本检查与全库修订守卫在同一 D1 事务提交，防止并发静默覆盖；响应丢失可通过回执恢复。网页与主站／独立服务 MCP 共用业务服务，不提供快捷采纳接口。

资源目录保留 `/api/catalog` 及相应 MCP 工具，权威切换详见 [ADR 0020](../docs/adr/0020-production-resource-authority.md)。旧 `/api/entries` 等仅供历史兼容读取，旧写接口返回 410；旧七天投票和首个达标淘汰其他候选的规则已停止对外使用。Agent 读取当前共识应通过知识库工具逐页读取主分支全文，不能用旧条目快照代替当前知识库。

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
