# 第三版设计资产

两张生图插画已直接用于原型；两件几何部件是原生 SVG，可改路径、尺寸和颜色。全部随应用本地提供。

| 资产 | 使用位置 | 可修改方式 |
| --- | --- | --- |
| [Agent 交接插画](../../../prototypes/frontend/public/art/agent-handoff-v3.png) | Agent 接入页右侧/手机说明上方 | RGBA PNG，透明背景；可改显示尺寸，或引用图片与提示词继续生图修改 |
| [观察员暂歇插画](../../../prototypes/frontend/public/art/observation-pause-v3.png) | 全部未读看完后的状态 | RGBA PNG，透明背景；适合白底与浅色底 |
| [观察输入框](../../../prototypes/frontend/public/art/note-frame-v3.svg) | 新观察输入框的阶梯边缘 | SVG 路径可编辑，非缩放描边；支持按容器拉伸 |
| [工作标记](../../../prototypes/frontend/public/art/work-marker-v3.svg) | 详情中工作负责的红色标记 | SVG 路径和填充可编辑 |

![Agent 交接插画](../../../prototypes/frontend/public/art/agent-handoff-v3.png)

![观察员暂歇插画](../../../prototypes/frontend/public/art/observation-pause-v3.png)

## 生成与修订来源

- 交接初稿：[图片](./asset-agent-handoff-v3.png)、[提示词](./asset-agent-handoff-v3.prompt.txt)。
- 暂歇初稿：[图片](./asset-observation-pause-v3.png)、[提示词](./asset-observation-pause-v3.prompt.txt)。
- [平面化修订提示词](./asset-flat-edit.prompt.txt) 记录一次探索；该轮模型生成了画出来的棋盘格背景，未作为最终资产。
- [背景提取提示词](./asset-background-extraction.prompt.txt) 用于取得真正透明的最终 PNG，发布文件以表格中的 `public/art` 链接为准。

最终两张 PNG 均为 1254 × 1254、RGBA，已检查 alpha 通道含 0–255 和大量全透明像素，不是棋盘格假透明。插画仍为单层位图，不能独立选取角色的眼睛、帽子或手臂；继续改角色细节需要图像编辑或生图。SVG 部件可用文本编辑器或矢量软件修改。

对应布局见 [08 · Assembly refined](../round-08-assembly-refined.png) 和 [09 · Working notebook](../round-09-working-notebook.png)。图中正文只是探索，正式字段及交互以代码和 PRD 为准。
