# 手机 UUID 兼容修复（#152）

用户在手机任务详情看到 `crypto.randomUUID is not a function`。在正式版本构建中屏蔽该浏览器 API 后，点击领取可复现相同错误：没有发出任务 POST，隔离数据库的负责人仍为空。错误发生在客户端生成请求编号时；用户实际浏览器版本和安全上下文未知，不能把此报错视为数据库损坏。

正式站与原型入口先加载共享兼容模块。支持 `randomUUID` 的浏览器继续使用原生函数；缺少时使用 `getRandomValues` 的 16 个安全随机字节生成 UUID v4，仅设置规范要求的版本和变体位。没有安全随机源或随机源报错时，不使用 `Math.random`、时间戳等弱随机替代。参考：[randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)、[getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)。

本次不改变界面布局、数据库结构、任务权限或业务状态。兼容代码在所有 UI 模块之前执行，也覆盖其他页面已有的请求编号和本地草稿编号调用。

验证：

- `node --experimental-transform-types scripts/verify-browser-crypto.mjs --reproduce`：对修复前构建，手机 390×844 下出现原报错，任务写入请求为 0，数据库未变。
- `node --experimental-transform-types scripts/verify-browser-crypto.mjs`：屏蔽原生 API、保留原生 API 两种环境下，真实 HTTP 领取及评论成功，刷新后仍可见；请求编号有效且互不重复，领取事件仅一条，无页面异常。原型在缺少原生 API 时也能启动。
- 类型检查、正式构建、247 项测试（含 4 项兼容测试）、40 项 DOM 测试和历史原型对照通过。
- 浏览器验收使用隔离 SQLite 和虚构任务，不写入线上人事资料。复现及修复截图、机器结果位于 `tmp/verification/browser-crypto/`。
- 新增浏览器验收纳入现有发布工作流，继续运行原有知识库及人事真实接口验收。

自动发布结果及线上加载验证另记录到任务交付说明；业务任务在用户确认交付前保持开启。
