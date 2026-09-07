# Cloudflare / MCP 技术验证

这是可抛弃的兼容性与业务边界探针，不是生产后端。`/probe/setup` 会重置绑定数据库的全部测试表；只能连接隔离的虚构数据资源。**禁止绑定生产数据库和图片桶。** 结论与范围见[验证报告](../../docs/technical-validation.md)。

## 本地复现

在本目录使用 Node.js 22 或更新版本：

```powershell
npm ci
node init-local.mjs
npx wrangler d1 execute cts-tech-spike-20260908 --local --file schema.sql
npm run dev
```

另开终端，在本目录执行 `npm run check` 和 `npm run verify`。结果写入被忽略的 `test-output/local-results.json`。初始化脚本生成随机测试令牌，拒绝覆盖已有凭证，不输出秘密；本地资源名来自 `wrangler.jsonc`。

## 云端复现

2026-09-08 的临时 Worker、D1、R2 与自定义域名绑定已删除。现有证据保存在 `docs/validation`，原地址不再提供服务。

再次验证时另建三个隔离资源，将 `wrangler.jsonc` 复制为被忽略的 `wrangler.remote.json`，填入新名称、D1 ID 和可用测试域名。应用 `schema.sql`，通过 Wrangler secret 设置 `PROBE_ADMIN`，其值须与本地测试凭证一致，避免输出到日志。检查所有绑定确属新建测试资源后部署。

在当前进程设置 `BASE_URL` 为新 Worker 地址后运行 `node verify.mjs`；该操作会重置测试数据。`probe-algorithms.mjs` 对比云端 PBKDF2 与 scrypt。CPU 测量另用 Wrangler tail；原始 tail 可能包含认证头，必须留在忽略目录，使用 `sanitize-tail.py` 仅提取路径和耗时。

## 真实 Codex 验证

使用 `codex-validation-prompt.txt`，把任意虚构 PNG 放在 `test-output/codex-upload.png`。只为本次 Codex 进程设置 MCP 地址和环境变量令牌，不改全局配置；测试身份为 alice，令牌从私有测试凭证传入。客户端必须具备读取该图片及 HTTP PUT 上传能力。

客户端最终输出保存为 `test-output/codex-final.json`，包含 `success,entity_id,record_id,attachment_id,image_bytes,sha256`。随后 `node verify-codex.mjs` 独立读取记录、核对图片大小/哈希并检查匿名拒绝。不要在独立校验之前再次运行会清库的 `verify.mjs`。

## 清理与边界

先保存脱敏证据，再用 `/probe/cleanup` 的受保护 GET 清点 `spike/` 对象；仅向 POST 提交核对过的对象键。清空后删除本次 Worker、D1、R2，并确认域名绑定消失。不能把该清理接口带入生产代码。

探针只覆盖选定的权限、关闭、事务、撤销和协议路径。输入校验、图片真实类型、分页、完整账号登录、生产日志和异常映射须在正式实现中补齐；不要直接部署本目录服务给真实成员使用。
