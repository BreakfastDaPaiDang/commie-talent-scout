# 待办、平铺标签与对象特征纠偏

2026-11-16，关联 #159、#160、#161。用户要求开始纠偏，特别检查前端及子目录。基于远端 main `c71d19c` 实施，未改数据库结构。

## 实际变化

- 登录后的根路径直接显示现有任务簿；主导航首项为“待办”。待处理列表排在完成统计和推荐卡片之前，320px 首屏可见。手机点开任务重置工作区滚动，顶部不被旧滚动位置截去。
- `/home` 及匿名根路径保留六色功能导航，登录账号菜单可返回。带 archive／observation／event 参数的旧根路径继续打开档案；任务、知识文档与原功能入口继续可达。
- 知识库以标签平铺筛选同一列表中的文档，详情展示标签，不显示层级面包屑；文档列表及编辑不再显示类型。新建文档明确选择标签，不默认套用第一个标签。切换标签移除旧详情，重复点击“全部”不会清空列表。
- 同步修正 `app/ui/knowledge/KnowledgeEditor.tsx`、主工作台、标签编辑／解释、评论、批注来源及帮助层。兼容原分类身份、文档种类及接口，既有分支、私人草稿、审核与历史引用保持原规则。
- `ObjectFeatures` 复用可见标签作为一组对象特征，应用到档案列表、档案详情和关联任务。详情优先重点标签，默认最多六项并支持展开／收起；标签仍可查看原绑定依据。完整编辑显示所有标签。

## 验证结果

- 类型、知识服务类型、架构边界、规则生成一致性、构建通过。
- 主站服务测试 271 项、知识服务测试 47 项、DOM 测试 40 项全部通过。
- `node scripts/check-ui.mjs` 通过：冻结历史 `531ab51` 对照当前原型和正式构建，1920／1440／1024／390px 无未授权几何差异或溢出；完整编辑、发布、标签依据、图片阅读等回归通过。
- `node --experimental-transform-types scripts/verify-whale-home-live.mjs` 通过：使用正式 React 构建、真实 HTTP 路由及隔离 SQLite 双数据库，验证原六个入口、返回待办、1440／390／320px 默认待办首屏、旧档案链接、重点特征、展开收起、依据、完整标签编辑、资料保存和观察发布。所有人物及材料均为虚构测试内容。
- `node --experimental-transform-types scripts/verify-knowledge-workspace.mjs` 通过：真实 HTTP 与独立双数据库，覆盖标签持久化、桌面／手机／320px 表单、共享原型、草稿、三人审核、多候选、批注、只读权限、帮助层及新平铺交互，无浏览器运行错误。

机器报告保存在 `tmp/verification/whale-home-live/report.json`、`tmp/verification/knowledge-workspace/report.json` 及同目录截图；下方保留本次检查的虚构界面截图。

- [320px 待办首屏](screenshots/frontend-feedback/todo-list-320.png)
- [桌面关联任务特征](screenshots/frontend-feedback/todos-1440.png)
- [知识库平铺标签与文档](screenshots/frontend-feedback/knowledge-desktop.png)
- [320px 完整标签表单](screenshots/frontend-feedback/tag-editor-320.png)
- [390px 展开发布区](screenshots/frontend-feedback/composer-390.png)

## 范围边界

对象特征使用已有可见标签，未新增从观察全文自动推断特征的机制。知识标签仍沿用原有稳定关联，未增加多标签数据迁移。原转述中未收到的截图没有被当作已经定位或验收的内容。

发布记录在完成自动流程及线上核对后补充。Issues 的业务结案与发布分开处理。
