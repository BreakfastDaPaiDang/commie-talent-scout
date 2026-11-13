# 知识库复用主站标签交互（#145）

2026-11-14，用户指出知识库分类应与其他位置使用同一套标签系统，附当前独立新建分类弹窗。实现按此前已确认的独立数据库边界，共用交互与组件，知识库分类词条继续由知识库保存。

## 实现范围

- 主站标签与知识库分类共用 `app/ui/TagCatalog.tsx` 的检索列表、标签外观、新建与编辑字段，以及 `app/ui/tags.css`；正式站与原型继续共用知识库组件。
- 分类加号打开检索，可按名称或解释找到已有词条，选择已有分类不写入新数据；没有适用项时再展开新建。返回查找保留搜索条件。
- 文档分类从自由文本改为同一词库选择入口。选择过程保留标题和正文，保存后引用既有分类；重载仍保持选择结果。
- 分类名称、解释仍独立维护，解释可批注、留言、从批注发起议题；旧引用与版本保留。未引入第二层分类或文档多分类，也未把人事词条混入知识库。
- 完整弹窗采用与操作区一致的内边距，修正原分类表单横向溢出；手机端可查看字段与操作按钮。

## 验收

`verify-knowledge-categories.mjs` 覆盖解释检索、选择复用、独立创建、更名、旧解释批注、议题引用与共享原型。

`verify-shared-tag-catalog.mjs` 由真实双数据库 HTTP 工作台验收调用，覆盖文档编辑中的选择与保存、刷新后回读、主站人物词条创建与详情、两边词库隔离、390px／320px 完整表单及返回查找。

沿用 `verify-knowledge-workspace.mjs` 的完整审核、评论批注、权限、分支删除与按钮说明回归，并运行类型检查、构建、共享 DOM 测试与历史原型对照。

截图：[分类检索](screenshots/knowledge-workspace/shared-tags-search-desktop.png)、[手机完整表单](screenshots/knowledge-workspace/shared-tags-category-320.png)、[主站共用新建表单](screenshots/knowledge-workspace/shared-tags-personnel-create.png)。机器报告存于 `tmp/verification/knowledge-workspace/report.json`，发布结果与线上核实另存任务进展说明。
