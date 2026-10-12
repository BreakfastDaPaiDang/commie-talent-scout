# 业务规则入口

前后端共享的判断和服务器执行的业务联动都在此目录。按领域找文件，不从 HTTP、MCP 或定时入口逐个查业务条件。

- `archive-states` / `person-identity`：身份、状态、成员范围与主操作。
- `archive-reminders` / `archive-reminder-query` / `contact-reminders`：提醒条件及同口径的查询排序。
- `archive-lifecycle` / `archive-task-cleanup`：状态变更、入社任务及删除后的任务联动。
- `archive-follow-up`：超期未更新的接触跟进任务。
- `task-policy` / `task-preferences` / `task-delivery`：默认标签与优先级、推荐、可交付提示。
- `task-notifications`：推荐推送、临期与逾期提醒。

共享策略不依赖数据库或服务类。产生写入的模块通过 `RuleModule` / `planRules` 返回计划；`app/server/` 负责读取、身份认证、幂等收据和提交。SQL 在执行时复核读取后的并发变化。模块可用类型导入描述上下文，不反向调用服务入口。

旧月度生成器及留档自动完成已删除。`monthly` 标签、任务数据和生命周期兼容逻辑用于保留历史，不代表周期生成已启用。新的社员跟进机制应作为独立规则加入，不恢复全档案批量生成入口。

现有技术规则视图继续运行 `npm run rules:generate` / `rules:check`；不新增面向使用者的中文规则表。
