# 深夜与护眼显示模式（#129）

顶栏和登录页共用显示模式选择器：日间、深夜、护眼。日间保留既有色彩，深夜为深灰底，护眼为暖米色底。仅浏览器本地保存偏好，不改账号资料或业务数据；同站点标签页同步，受限存储时当页仍可切换。

共享组件和正式适配器样式采用带原色回退的主题变量。头像、图片、阶段及资源颜色保留；深夜的提交趋势线及同色图例同步提亮。周报是独立日间文档，不继承用户主题。窄桌面工具项进入原工具菜单，避免账号与主题入口重叠。

2026-11-08 验证：隔离 SQLite、真实 Worker HTTP、Edge；全部使用虚构档案与账号，不读写生产业务数据。

- 桌面 1440px、手机 390px：两种模式的任务详情、完整交付弹窗、完整档案编辑、统计页及资源编辑；实际保存资源并刷新回读。
- 375/768/1024/1201/1280px：顶栏可点击控件不互相覆盖、不超出屏幕。
- 模式切换、键盘操作、刷新持久化、跨标签页同步。
- 未登录切换并刷新，真实登录后保留主题与原任务分享目标。
- 应用脚本尚未加载时已恢复主题；存储拒绝访问时页面可用且仍可切换。
- 正式站与原型使用同一 ThemePicker；原型桌面和手机深夜配色一致。
- 类型检查、构建、39 项 DOM 回归、历史原型对照及真实接口工作总览验证。

验证脚本：`scripts/verify-display-modes.mjs`，由 `scripts/verify-work-overview.mjs` 在真实接口夹具中执行并纳入 CI。

| 页面 | 深夜 | 护眼 |
| --- | --- | --- |
| 桌面任务 | [截图](screenshots/display-modes-129/night-tasks-1440.png) | [截图](screenshots/display-modes-129/care-tasks-1440.png) |
| 手机任务 | [截图](screenshots/display-modes-129/night-tasks-390.png) | [截图](screenshots/display-modes-129/care-tasks-390.png) |
| 手机交付 | [截图](screenshots/display-modes-129/night-delivery-390.png) | [截图](screenshots/display-modes-129/care-delivery-390.png) |
| 手机编辑 | [截图](screenshots/display-modes-129/night-archive-editor-390.png) | [截图](screenshots/display-modes-129/care-archive-editor-390.png) |
| 统计 | [截图](screenshots/display-modes-129/night-statistics-1440.png) | [截图](screenshots/display-modes-129/care-statistics-1440.png) |
