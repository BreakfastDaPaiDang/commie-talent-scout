# 档案、任务与观察分享（#121）

在共享界面中增加红色描边分享按钮：档案顶栏、任务详情顶栏、观察操作栏。一次点击复制干净的目标链接；剪贴板拒绝时只展开可选中的链接。观察分享进入展开阅读、自动定位、显示所属档案并突出该条，同一正文不在下方重复出现。

统计页人员姓名直达档案，经历色块保留侧栏。提交成员仅按 `linked_account_id` 显式关联，未关联与已删除档案不显示跳转。

## 验收

2026-11-08，隔离 SQLite + 真实 Worker HTTP + Edge，使用虚构档案和账号，不读写生产业务数据。截图来自实际页面；脚本为 `scripts/verify-work-overview.mjs`。

- 档案、任务、观察：1440px / 390px 下分享、复制 URL、接收端打开、刷新和返回，再次回到原目标。
- 未登录接收端：三种目标均实际填写测试账号登录，登录后保留目标；观察定位仍正确。
- 权限：未登录 API 返回 401；非作者普通成员打不开已删除观察，已删除档案同样给出明确错误；缺失任务/观察有可返回的反馈。
- 复制失败：显示选中的链接供手动复制，手机不横向溢出。
- 既有行为：保留经历侧栏未保存内容保护、版本引用、任务与观察编辑，以及历史原型。
- 类型检查、构建、235 项服务测试、39 项 DOM 和历史界面检查通过。

## 界面截图

| 场景 | 桌面 | 手机 |
| --- | --- | --- |
| 档案分享 | [桌面](screenshots/sharing-121/share-archive-1440.png) | [手机](screenshots/sharing-121/share-archive-390.png) |
| 任务分享 | [桌面](screenshots/sharing-121/share-task-1440.png) | [手机](screenshots/sharing-121/share-task-390.png) |
| 观察定位 | [桌面](screenshots/sharing-121/share-observation-1440.png) | [手机](screenshots/sharing-121/share-observation-390.png) |

[登录后回到观察](screenshots/sharing-121/share-login-observation.png) · [已删除观察不可见](screenshots/sharing-121/share-deleted-observation.png) · [手动复制](screenshots/sharing-121/share-fallback-task-390.png)
