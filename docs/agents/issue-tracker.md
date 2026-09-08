# 任务跟踪

仓库：BreakfastDaPaiDang/commie-talent-scout。
需求和开发任务使用 GitHub Issues，通过 gh CLI 操作。

- 发布到任务跟踪器：创建 GitHub Issue。
- 获取任务：读取 Issue 正文、标签和评论。
- 多行正文或评论：写入临时文件，通过 --body-file 提交。
- 外部 PR 不纳入需求分诊；开发工作可以正常使用 PR。

产品需求基线维护在 [docs/PRD.md](../PRD.md)。后续发布 PRD 到任务跟踪器时，
在 Issue 中引用对应文档和版本，避免维护两份独立演进的正文。

正式首版使用 `v0.1.0` 里程碑；PRD 文档修订号和原型/探针包版本不作为产品版本。创建首版实施 Issue 时关联该里程碑，正文填写可验收路径及真实阻塞 Issue；标签 `ready-for-agent` 表示需求完整，不代表阻塞依赖已完成。
