# 脱敏验证证据

对应 [2026-09-08 技术验证报告](../technical-validation.md)。

| 文件 | 内容 |
| --- | --- |
| local-v1.2-deleted-visibility.json | v1.2 本地 16 项通过，新增删除读取权限断言；不代表新增规则已上云 |
| local-results.json | 本地行为套件，16 项通过 |
| cloud-results.json | 实际 Cloudflare 行为套件，16 项通过 |
| cloud-password-algorithms.json | 云端 PBKDF2 限制与 scrypt 成功响应 |
| cloud-cpu-timings.json | 从 Wrangler tail 提取的请求 CPU / wall 时间 |
| codex-image-verified.json | 真实 Codex 图文写入后的独立字节、哈希和访问检查 |

不保存请求认证头、密码、个人令牌、上传票据或真实业务材料。测试对象 ID 与运行 ID 仅对应已删除的虚构测试数据。耗时是单次观测，不作为性能分位数或服务等级保证。
