# 任务跟踪

仓库：BreakfastDaPaiDang/commie-talent-scout。
需求和开发任务使用 GitHub Issues，通过 gh CLI 操作。

- 发布到任务跟踪器：创建 GitHub Issue。
- 获取任务：读取 Issue 正文、标签和评论。
- 多行正文或评论：写入临时文件，通过 --body-file 提交。
- 外部 PR 不纳入需求分诊；开发工作可以正常使用 PR。

当前 PRD.md 保留为需求对齐草案。后续正式发布 PRD 时，
在 Issue 中引用对应文档和版本，避免维护两份独立演进的正文。
