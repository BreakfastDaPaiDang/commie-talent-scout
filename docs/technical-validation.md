# 技术验证结果

日期：2026-09-08（北京时间）。基线为 [PRD v1.1](./PRD.md)。本次验证使用独立 Cloudflare 资源与虚构数据，验证代码位于 [spikes/cloudflare-mcp](../spikes/cloudflare-mcp/)。前端原型与该验证服务分开运行。

## 结论

可以采用 Cloudflare Worker + D1 + 私有 R2，并在同一业务层上提供网页接口和 MCP。D1 原子写入、权限复核、关闭锁定、恢复删除、并发冲突、幂等重试与凭证撤销均有云端实测证据；真实 Codex 已完成约 900 KB 图片上传和图文记录创建。

密码存储有一项实际兼容性调整：云端不支持预设的 600,000 次 PBKDF2，改选符合 OWASP 参数组合的原生 scrypt。scrypt 探针请求的实际 CPU 时间为 402 ms，因此正式方案应按 Workers Paid 档位评估，不能以免费档的 10 ms CPU 配额为前提。

这些结果足以进入正式实现，不等同于生产应用、完整登录流程、大陆所有运营商或全部客户端已经验收。

## 环境与证据

| 项目 | 实测条件 |
| --- | --- |
| Worker | 临时 `cts-tech-spike-20260908`，兼容日期 2026-09-01，开启 `nodejs_compat` |
| D1 | 独立虚构数据；创建位置提示 APAC，返回元数据为 SIN / primary |
| R2 | 独立私有桶，仅通过带认证的 Worker 图片路由读取 |
| 域名 | 临时 `cts-probe-20260908.dapaidang.org`；正式 `scout.dapaidang.org` 尚未部署 |
| 服务依赖 | Hono 4.13.7、Agents 0.22.0、MCP Server/Client 2.0.0、旧版 MCP SDK 1.30.0、Wrangler 4.129.1 |
| 真实客户端 | Codex CLI 0.153.0，临时进程配置与环境变量凭证，未修改用户全局配置 |
| 验证入口 | HTTP/Cookie、Bearer、MCP SDK、真实 Codex CLI |

已剔除凭证及上传票据的机器结果保存在 [validation](./validation/)；原始 Codex 和 Wrangler 日志不提交。版本号和锁文件仅固定本次验证环境，正式代码应按实施时可用版本和兼容性决定。

## 自动化行为验证

本地与真实云端各 **16/16 通过**。这是经过 scrypt 替换和上传票据撤销修复后的结果。

| 场景 | 云端结果 |
| --- | --- |
| 未认证访问 API / MCP | 拒绝 |
| Cookie 鉴权、跨来源 Cookie 写入 | 合法请求成功，跨来源写入拒绝 |
| MCP v2 发现工具与确认身份 | 成功 |
| 旧版 2025 协议客户端访问 v2 服务 | 成功 |
| 新版协议自动协商访问无状态服务 | 成功 |
| 附件前置条件失败发生在写入记录之后 | 整个 D1 batch 回滚，记录、版本、事件均未残留 |
| MCP 申请上传票据 → R2 → 图文记录 → 认证读取 | 成功；未登录读取拒绝；重复使用票据拒绝 |
| 作者、其他成员、管理员对删除和恢复的权限 | 两入口一致；管理员操作不转移原始作者身份 |
| 关闭档案中新增、删除记录，重新开启后继续 | 关闭时拒绝，包括管理员；开启后成功 |
| 两个客户端同时编辑同一版本 | 仅一次成功，另一次冲突，版本没有相互覆盖 |
| 同时关闭与新增记录，重复 5 组 | 未出现关闭事件之后仍成功创建记录的情况 |
| 同一写入并发重试 5 次 | 只创建一条记录及一个事件；换内容复用请求 ID 被拒绝 |
| 成员之间的未读互不干扰 | 成功；标记已读不改变档案活动时间 |
| 冻结账号后，已连接的 MCP、图片读取及旧票据 | 均被拒绝；解冻不会复活旧凭证或旧上传票据 |
| 两名管理员同时将自己降权 | 只允许一次，保留一名未冻结管理员 |
| scrypt N=32768 / r=8 / p=3 | 云端原生运行成功 |

关闭与记录权限的验证覆盖的是选定的关键路径；正式实现仍须补全 PRD 全部状态、资料字段、负责人、操作入口和异常情况，不能直接把 spike 当成完整领域模型。

## 真实 Codex 的图片路径

Codex 实际调用了 `whoami`、`create_entity`、`prepare_image_upload`、`create_record`、`get_entity`。本机计算图片大小和哈希，拿到短期票据后用本地 HTTP 客户端上传二进制，再通过 MCP 绑定附件。

- 图片：922,428 bytes。
- SHA-256：`ad9ad3bd2797095f80ca9b033e6eda81fc7e7c0e483ce478a936f5345f80e864`。
- 独立校验：通过网页业务接口读取记录，确认作者及 `mcp` 来源；另行认证下载图片核对字节和哈希；匿名读取返回 401。

第一次客户端测试被其本地执行策略阻止了读取文件，诚实报告未完成。随后在当前已授权的本地测试权限下重新运行，完整成功。由此得到的产品要求是：接入说明必须同时解释 MCP 连接与本地文件上传能力；仅有 MCP 工具连接不代表客户端一定允许读取、上传本机文件。

此处“网页业务接口读取”不是已经在生产网页看到了图片。当前前端原型未接云端服务，最终仍须完成正式网页 + Codex 的联合验收。

## 密码算法与运行成本

本地运行成功的 PBKDF2-SHA256 600,000 次在真实云端返回限制错误：迭代次数不能超过 100,000。本次没有通过降低迭代次数规避问题。

改用 `node:crypto` 原生 scrypt，参数 `N=32768,r=8,p=3,keylen=64,maxmem=64 MiB`；参数组合对应 OWASP 列出的 32 MiB 方案，见 [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。Cloudflare 的 [Node.js crypto 支持文档](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)与本次云端调用共同支持该选择。

一次 Wrangler tail 实测：整个 scrypt 探针请求 CPU **402 ms**、服务端 wall **598 ms**；同次客户端测得总耗时 **806 ms**。CPU 包含鉴权等请求开销，这不是压测结果或 p95。Worker 内部 `Date.now()` 在该计算段返回 0 ms，不作为 CPU 证据；以 tail 的测量为准。

Workers Free 的单请求 CPU 配额为 10 ms；Paid 官方起步价为每月 US$5，并包含一定请求与 CPU 额度，见 [Workers 定价](https://developers.cloudflare.com/workers/platform/pricing/)。当前 OAuth 不能读取账号订阅，因此尚未确认该账号是否已经具备相应套餐，也没有变更套餐或购买服务。

正式登录实现须先做限速，再计算密码；为同一 isolate 内的昂贵 KDF 设置并发上限，避免内存叠加。Workers 的 [128 MB 内存边界](https://developers.cloudflare.com/workers/platform/limits/)不能仅靠单请求成功证明已满足。首次登录、更改密码、临时密码、更换会话、异常限速和登录并发需要作为第一条实施切片继续验证。

## 大陆无代理访问

本机 `curl --noproxy '*' --proxy ''` 访问临时自定义域名返回 200，Cloudflare 观察到 `country=CN`、`asn=4837`（中国联通）、接入 colo 为 LAX；该次请求总耗时约 0.98 秒。本机默认路由为 WLAN，未发现 Tailscale 默认出口路由。随后在 Node 未启用环境代理的条件下，完整云端行为套件通过。

这是一个大陆联通网络、一个测试时段的真实证据，不扩展成全国可用性保证。部署与 Cloudflare 管理操作使用了环境现有代理；这些管理操作不作为大陆访问证据。Codex 模型服务自身的网络也不属于网页无代理承诺。

上线仍需使用正式域名，补测真实账号密码登录、完整网页操作及多图上传，并覆盖能取得的其他成员网络。跨境访问的延迟和可靠性仍可能变化，参见 [Cloudflare China Network](https://developers.cloudflare.com/china-network/)。

## 本次没有证明的内容

- 生产级账号密码登录、完整会话生命周期、密码限速与并发内存表现。
- 所有 PRD 字段和业务状态、记录图片修改后的版本引用、完整分页和搜索。
- GitHub 自动部署、真实数据备份恢复演练、正式域名上线。
- 跨运营商长期可用性、所有第三方 MCP 客户端兼容性。
- QQ 头像在本项目的云端集成。已审阅用户提供的 makeshift-dev 源码，采用说明见 [设计说明](./design/README.md)。

这些项目进入正式实现与上线验收，不以当前 16 项通过替代。

## 验证资源清理

2026-09-08 已清点并删除 4 个 `spike/` 虚构图片对象，删除临时 Worker、D1 数据库及 R2 桶；Cloudflare API 确认测试域名绑定剩余 0 项。Wrangler tail 已停止。正式 `scout.dapaidang.org` 未部署，现有其他 Cloudflare 项目未修改。原测试地址不再用于后续验收。
