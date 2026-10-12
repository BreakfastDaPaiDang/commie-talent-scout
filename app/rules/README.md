# 业务规则入口

前后端共享的判断和服务器执行的业务联动都在此目录。按领域找文件，不从 HTTP、MCP 或定时入口逐个查业务条件。

- `service-subjects`：服务账号稳定标识；用于系统任务归属，和真人账号、社员档案区分。
- `person-account`：社员本人账号绑定的授权、真人身份、唯一性和名称权威来源；不与维护者关联混用。迁移 `0032` 在账号资料历史事务内同步昵称，保留历史与联系更新时间。
- `archive-states` / `person-identity`：身份、状态、成员范围与主操作。
- `archive-reminders` / `archive-reminder-query` / `contact-reminders`：提醒条件及同口径的查询排序。
- `archive-lifecycle` / `archive-task-cleanup`：状态变更、入社任务及删除后的任务联动。
- `archive-follow-up`：超期未更新的接触跟进任务。
- `task-policy` / `task-preferences` / `task-delivery`：默认标签与优先级、推荐、可交付提示。
- `task-notifications`：推荐推送、临期与逾期提醒。

共享策略不依赖数据库或服务类。产生写入的模块通过 `RuleModule` / `planRules` 返回计划；`app/server/` 负责读取、身份认证、幂等收据和提交。SQL 在执行时复核读取后的并发变化。模块可用类型导入描述上下文，不反向调用服务入口。

旧的全档案月度生成器及留档自动完成已删除。正式社员月度跟进由独立的 `member-monthly-follow-up.ts` 规则负责：北京时间每月一项、P2、月底截止、早纪发起、待领取；每小时补漏，同一档案同一月份去重。观察记录不会自动完成任务，须显式交付。

现有技术规则视图继续运行 `npm run rules:generate` / `rules:check`；不新增面向使用者的中文规则表。
