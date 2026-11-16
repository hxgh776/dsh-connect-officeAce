# Changelog

## 0.2.0 — 2026-11-16

补上 0.1.0 里被错误归为「证据不足」的两块：本机登录态复用与模型网关地址。**这两条推翻 0.1.0 的结论：不是证据不足，是当时没去读。**

### 新增

- `src/wincred.ts`：`CredRead`（经短命 PowerShell 子进程）读 `wincred://OfficeAce/auth-sessions/.../provider-state`，解析 manifest（UTF-16LE JSON，`chunkCount`/`storageId`），按序拼接 `.../chunks/<storageId>/<n>`，base64 解码成 provider-state JSON。只读、不落盘、不进日志/路由/错误消息。
- `AccessResolver`：凭据来源扩为 `settings | env | local-session`，显式设置仍优先，本机登录态兜底；解析结果缓存 60 秒，设置变更即失效。Bearer（显式 Key）与 Basic（app-key 对）两种鉴权自动切换。
- `baseUrl` 默认值改为从 `providerState.modelInfo.model_api_url_base` 推导的 `https://<host>/v1`，并标【实测】。
- 目录过滤：`/v1/models` 混有图像/视频/embedding/rerank 模型，按 id 启发式剔除（`isLikelyChatModel`）。
- `VERIFIED_WORKING_MODEL_IDS` / `DEFAULT_PROBE_MODEL`：`deepseek-v4-flash` 是实测能返回 200 的模型。
- 测试 67 条（新增 wincred 解码、AccessResolver 优先级/缓存、Basic 鉴权、聊天模型过滤）。

### 实测结论（详见 docs/protocol.md）

- 网关鉴权是 **HTTP Basic `<model_app_key>:<model_app_secret>`**；Bearer / X-Auth-Token / AppCode / SDK-HMAC-Access 全部 401 `APIG.0303`。
- 路径是 **`/v1/models` 与 `/v1/chat/completions`**；`/models`、`/inference/v1/chat/completions`、`/` 均 404。
- 流式响应含 `delta.reasoning_content`、`delta.tool_calls`、usage chunk、`data: [DONE]`，即原生 OpenAI 兼容。
- OfficeAce 配置里的 `deepseek-v4.1-flash` 在本机账号上 **404 not available**；`deepseek-v4-flash` 可用。配置默认模型 ≠ 账号可用模型。

### 移除/修正

- 删除 `DEFAULT_BASE_URL = https://api.office-claw.com/v1`（那是应用 API，不是模型网关，属 0.1.0 的推断错误）。
- README/协议里「本机登录态不可读」「复用本机登录 ❌」的说法全部删除并改写。

### 已知限制

- 本次 agent 运行在 Windows 沙箱，Node spawn 管道子进程被拒（`spawn EPERM`），因此 `probe` 的端到端那一次用 `DSH_OFFICEACE_PROVIDER_STATE_FILE` 注入已解码状态；wincred 的 PowerShell 程序与 Node 解码器都单独验证过（见 protocol §6）。
- 上下文窗口仍是假设值（`/v1/models` 不返回）。

## 0.1.0 — 2026-11-16

首个版本。**定位是「骨架 + 已核实事实」，不是端到端可用的成品。**

### 新增

- Cordis 插件入口：注册 `officeace` provider、可配置 provider 目录项、模型发现回调、设置呈现。
- loopback shim：`127.0.0.1` 随机端口、进程内 `base64url` secret（`timingSafeEqual`）、Host/Origin 门禁、64MB 请求体上限、300s 流式空闲看门狗、SSE 原样透传与在途错误帧。
- pi-ai 适配：`openai-completions`，含 legacy/modern 两代 context 形态的折叠（跨 host 版本）。
- 只读本地状态：`%LOCALAPPDATA%\Programs\OfficeAce\data\storage.sqlite` 的 `oc_kv_string`，解析 `office-claw:oc:session:user:*` 与 `office-claw:runtime:api-instance-lease:v1`。
- 目录发现与缓存：上游 `/models` → `~/.dsh/dsh-connect-officeace.catalog.json`；失败不清空选择。
- 设置文件：`enabledModelIds` / `apiKey` / `baseUrl` / `installRoot` / `defaultContextWindow`，同步原子写。
- web 路由：`/plugins/dsh-connect-officeace/{status,catalog,__save}`，先过宿主 Connection 门禁，写路由加 `x-dsh-officeace-write`。
- CLI：`doctor`（五项只读检查）、`probe`（一次真实流式对话）、`bin` 分发。
- 文档：`docs/protocol.md` 逐条标注【实测】/【参考】/【推断】，并列出明确没做的能力。

### 决策与依据

- **不内置模型兜底目录**：唯一能核实的是 OfficeAce 自身 agent 配置里的两个 `defaultModel` id；把它们当可选项会顺带臆造上下文长度。改为诊断用 `KNOWN_MODEL_IDS`。
- **上下文窗口默认 200000 是假设**，不是实测。因为 DSH 会因单个模型缺 `contextWindow` 拒绝整个 provider，只能给默认值；已做成设置项并在 README/protocol 标注。
- **不复用本机登录**：OfficeAce 的 token 在 Windows 凭据管理器，密钥还包了 DPAPI。参考实现里没有对应做法，做成半成品比不做更糟。
- **不做用量看板**：没有可验证的查询接口。Loomy/Trae 的积分接口是各自的，不能套用。
- **不用 tsdown，用 tsc**：本仓库没有客户端 UI 产物，tsc 直接 emit + declaration 足够，且少一个构建期依赖；与参考实现的差异已记录。
- **测试走单进程 runner（`scripts/test.mjs`）**：`node --test <dir>` 会为每个文件 spawn 子进程，在 Windows 沙箱下 piped stdio 被拒（EPERM）。单进程导入保持 `node:test` 语义与失败退出码。

### 已知缺口

- 未做真实上游调用（缺凭据）——`probe` 已就绪。
- 本地 API 服务 `127.0.0.1:3004` 实测连不上（连接被重置），因此不依赖它。
- 没有客户端 UI（settings 卡片由宿主渲染 schema 字段）。
