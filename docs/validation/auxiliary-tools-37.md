# 辅助工具页与 QCE 操作指南验收

日期：2026-09-10。关联：[Issue #37](https://github.com/BreakfastDaPaiDang/commie-talent-scout/issues/37)。决策：[ADR 0013](../adr/0013-local-qce-export-guidance.md)。

## 交付

正式站 `/tools` 从账号菜单与手机工具导航进入。QCE 推荐、最新 Framework Releases 链接、完整解压/启动/登录/导出 TXT 教程由 `app/ui/AuxiliaryTools.tsx` 共享给正式站和原型。页面不请求成员本机 QCE，也不提供聊天上传或导入。

MCP 的初始化说明、概览、`whoami.guide_topics` 和 `get_usage_guide` schema 均可发现 `qq_export`。指南包含本机能力、QCE 识别与在线状态、便携目录定位、启动和会话中断授权、本机令牌、会话/时间范围、异步导出及任务恢复。导出接口、时间单位、TXT 格式、资源下载选项、任务与认证合同按 QCE v6.2.10 上游源码核对；执行时要求 Agent 再核对实际版本。

## 验证

- 类型检查、构建及迁移清单检查通过；业务测试 76/76，DOM 测试 17/17。
- `check-ui.mjs` 四组回归通过，包括不可变历史原型 `531ab51` 四种宽度的对照、完整编辑、发布区、卡片及标签检查。
- `verify-auxiliary-tools.mjs` 本地 5 项、云端 4 项通过：真实 MCP 主题发现与调用、旧 compression 指南、桌面菜单和直接刷新、1024/390/360px 导航与完整教程、外链目标、无横向溢出和运行错误。页面没有请求本机 40653 服务。
- 本地还验证原型入口，并核对其共享页面正文与正式站相同。桌面、手机顶部和教程底部截图已人工查看；测试站桌面截图复核通过。
- `verify-workspace-ui.mjs` 本地与云端各 6 项通过，覆盖真实编辑、状态和关联成员、标签、观察版本、私有草稿及 PNG 图文发布。验收连接撤销，原有脚本创建的虚构档案按约定关闭。

报告：[本地辅助工具](./auxiliary-tools/local.json)、[云端辅助工具](./auxiliary-tools/cloud.json)。截图生成于 `tmp/verification/auxiliary-tools-*.png`。

## 隔离部署

测试站部署版本 `fc8afef2-aba7-4882-8363-028fd8db5ea4`；部署前备份 `snapshots/staging/2026-09-10T06-41-31.140Z-2c412c51-c851-4e62-bcba-7a38410f9800`。17 项既有迁移、实际静态资源字节、私有入口和 D1 登录冒烟通过。

本次没有新增数据库迁移，不修改 QCE 或成员电脑配置。验收对象是网页与 MCP 指南，没有为验证而读取或导出成员真实聊天；这不构成对任意 QQ 版本、账号或历史记录完整性的保证。
