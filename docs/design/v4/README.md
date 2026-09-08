# 第四版品牌资产

| 资产 | 用途 | 格式与修改 |
| --- | --- | --- |
| [观察之星 Logo](../../../prototypes/frontend/public/art/brand-star-v4.svg) | 顶部导航、登录、favicon | 原生 SVG：红色星形、白色眼形与瞳孔分开，可编辑路径与颜色 |
| [巨星上的协作观察](../../../prototypes/frontend/public/art/login-observatory-v4.png) | 桌面登录页主插画 | PNG 位图，完整构图按容器缩放；手机隐藏插画，优先表单 |
| [Logo 探索](./logo-exploration.png) | 设计过程 | 生图探索稿，最终 SVG 采用星形/视线关系，未沿用发光背景和阴影 |

![最终 Logo](../../../prototypes/frontend/public/art/brand-star-v4.svg)

生成使用内置 imagegen。[Logo 提示词](./logo-exploration.prompt.txt) 和 [登录插画提示词](./login-observatory.prompt.txt) 可继续复用。登录插画是单层位图，不冒充矢量或分层源文件；Logo 是独立重绘的矢量资产。

登录页只保留品牌一次、猎头账号、密码和登录按钮。去掉重复标题、说明、占位提示和页脚；不为填满版面编造口号。原型状态说明只保留一句，正式页不需要。

第三版的 Agent 交接、暂歇插画和几何部件继续使用，见 [第三版资产](../v3/README.md)。
