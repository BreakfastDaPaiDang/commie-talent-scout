# 脱敏验证证据

## 当前正式交付

- [v0.1.0 首次上线](./v0.1.0-release-acceptance.md)：正式网页、真实客户端、权限、备份与隔离恢复。
- [v0.1.1 绑定材料](./materials-0.1.1.md)：真实上传、容量、预览、维护和恢复。
- [词库删除与默认查询](./tag-deletion-32.md)：标签及类别清理、引用保留和云端界面。
- [超期跟进提醒](./archive-reminders-33.md)：30/7 天边界、分页排序、桌面和手机更新/关闭；当前全套 64 项业务测试、8 项 DOM 测试通过。
- [首次密码设置](./password-setup.md) / [页面恢复与材料整理](./compression-and-browser-state.md)：登录与 Agent 使用改进。

## 早期技术验证

以下对应 [2026-09-08 技术验证报告](../technical-validation.md)，保留当时范围与限制，不作为当前上线状态说明。

| 文件 | 内容 |
| --- | --- |
| local-v1.2-deleted-visibility.json | v1.2 本地 16 项通过，新增删除读取权限断言；不代表新增规则已上云 |
| local-results.json | 本地行为套件，16 项通过 |
| cloud-results.json | 实际 Cloudflare 行为套件，16 项通过 |
| cloud-password-algorithms.json | 云端 PBKDF2 限制与 scrypt 成功响应 |
| cloud-cpu-timings.json | 从 Wrangler tail 提取的请求 CPU / wall 时间 |
| codex-image-verified.json | 真实 Codex 图文写入后的独立字节、哈希和访问检查 |

不保存请求认证头、密码、个人令牌、上传票据或真实业务材料。测试对象 ID 与运行 ID 仅对应已删除的虚构测试数据。耗时是单次观测，不作为性能分位数或服务等级保证。
