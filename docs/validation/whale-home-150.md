# 六色鲸鱼娘主页（#150）

主页 `/` 使用六张独立透明图片，每位角色都有自己的链接、悬停和键盘焦点。中央蓝色进入 Agent 接入；外围红色进入外部人物、黄色进入社员、绿色进入任务、黑色进入仪表盘、紫色进入知识库。

用户最终确认组织不占主页入口，不跳转，也不合并到外部人物的类型切换。原有组织档案与旧分享链接保持兼容。

正式站与 `?home` 原型共用 `WhaleHome`。主页可在登录前浏览；受保护入口保留目标，登录后继续原页面。外部人物入口使用 `/people`，旧 `/?archive=…` 等档案链接仍直接打开详情。顶栏品牌返回主页；同一路径的查询参数和浏览器前进／返回也会更新页面。

## 图片

使用内置 image_gen 逐张生成；[提示词集合](../design/assets/whale-home-v1/prompts.json)和六张原始透明 PNG 保存在 `docs/design/assets/whale-home-v1/`。上线图片在 `public/art/whale-home/`：蓝色 960px，其余 640px，六张共 535,738 字节。每张均验证保留 0–255 alpha 与透明角落。

## 验证

- 类型检查和生产构建通过。
- `scripts/verify-whale-home.mjs`：1440、1024、768、600、390、320px × 日夜共十二组生产产物检查。六个独立图片及链接、无横向溢出、点击区不重叠、顶栏控件完整、键盘激活、登录目标保留。
- `scripts/verify-whale-home-live.mjs`：隔离人员数据库及独立知识库数据库，真实 HTTP，1440/390px 逐个进入六个页面再返回主页；外部人物不出现新增组织类型切换。[结果](screenshots/whale-home/live-navigation.json)。
- `scripts/check-ui.mjs`：历史原型对照、完整档案编辑、观察发布、头像与图片交互回归通过。
- `scripts/verify-work-overview.mjs`：真实登录、档案分享、完整编辑、日夜主题、手机操作与共享原型回归通过。

截图：[桌面](screenshots/whale-home/desktop.png)、[手机](screenshots/whale-home/mobile.png)、[深夜手机](screenshots/whale-home/night-mobile.png)。

知识库入口复用已合入 #149 / #145 的现有页面与服务，主页基于最新主分支发布，`/knowledge` 直接进入知识库。
