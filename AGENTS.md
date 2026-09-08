## Agent skills

### Issue tracker
需求和开发任务使用本仓库的 GitHub Issues。
外部 PR 不作为需求分诊入口。
详见 docs/agents/issue-tracker.md。

### Triage labels
使用 Matt 默认的五种分诊标签。
详见 docs/agents/triage-labels.md。

### Domain docs
采用根目录 CONTEXT.md 和 docs/adr/ 的单一上下文布局。
详见 docs/agents/domain.md。

### 已确认的前端
已确认原型是正式前端的代码基线。正式化应在同一套界面组件上接入真实接口、权限和持久化；不得另写一套页面，再靠复制或覆盖样式追赶原型。
共享界面位于 `app/ui/`，原型与正式站均引用它。布局或交互需要改变时，先向用户明确说明。修改后运行历史原型对照与真实接口界面验证，详见 docs/agents/frontend.md。

常态界面只展示完成当前任务所需的内容；存储期限、排错记录、版本实现等说明不得塞入主要使用流程。完整展开的编辑表单、发布区及手机端操作必须单独验收，不能用基础样式相等代替用户体验检查。
