# DSH Connect OfficeAce

把本机安装并登录的 [OfficeAce](https://www.office-claw.com)（华为云）桌面端接入 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)：OfficeAce 的模型出现在 DSH 模型选择器，OpenAI 兼容请求经进程内 loopback shim 转发到模型网关，`bash` / `read` / `write` / `edit` 等工具仍由 DSH 本地执行。

架构与工程约定参照 `dsh-connect-trae`（远端）与 `dsh-connect-loomy`（本机）。

**不用填 Key。** 插件从本机 OfficeAce 的登录态里读出模型网关地址与凭据：`CredRead` 读 Windows 凭据管理器里的 provider-state（manifest + 6 个分块），拼接后 base64 解码得到 JSON，取 `modelInfo.model_api_url_base` 与 `model_api_auth_info` 的 app-key 对，`/v1/chat/completions` 用 HTTP Basic 调用。只读、不落盘、不进日志、不进 web 路由响应。

逐条依据见 [docs/protocol.md](docs/protocol.md)（【实测】/【参考】/【推断】）。

## 完成度

| 能力 | 状态 | 依据 |
|---|---|---|
| DSH provider 注册 / 模型选择器 | ✅ 已实现 | 参考实现 |
| loopback shim（随机端口 + 进程内 secret + 流式透传） | ✅ 有测试 | 参考实现 |
| pi-ai 适配 + 跨版本 context 折叠 | ✅ 已实现 | 参考实现 |
| 复用本机 OfficeAce 登录态（免 Key） | ✅ 已实现；真机解出网关与凭据 | **实测**：wincred manifest/chunks → base64 → JSON |
| 模型网关地址与鉴权 | ✅ 实测 | `https://<model_api_url_base>/v1` + Basic app-key |
| 对话：SSE / reasoning / tool_calls / usage | ✅ 实测 200 + 流式增量 | 见 protocol §3 |
| 上游端到端 `probe` | ✅ 真跑通（`deepseek-v4-flash`） | 见下方验证 |
| 设置面板（`settings.section`） | ✅ 已实现；浏览器端脚本静态校验 | `src/client.js` → `lib/client.js`，见「设置面板」 |
| 用量 / 积分看板 | ❌ 未实现 | 没有可验证的查询接口 |
| 每日签到、模型管理 UI、多区域面板 | ❌ 不在范围 | 无证据，不臆造 |

## 前提

- 先安装并登录 OfficeAce 桌面端（插件不做登录，也绝不代登录）。
- Windows x64。插件读取安装目录下的本地状态库与当前用户的 Windows 凭据管理器。
- 运行插件的进程要能启动一个短命的 PowerShell 子进程（`CredRead` 的传输通道）。DSH 宿主进程满足；受限沙箱可能不满足（见「已知限制」）。

## 工作方式

```
DSH pi-ai provider (openai-completions)
  → 进程内 loopback shim（127.0.0.1 随机端口 + 进程内随机 secret）
    → https://<modelInfo.model_api_url_base>/v1/chat/completions（HTTP Basic app-key）
```

- **登录态**：只读 `%LOCALAPPDATA%\Programs\OfficeAce\data\storage.sqlite` 找到当前账号的 `providerStateRef`，再只读 Windows 凭据管理器里的 manifest + 分块；解码出的网关地址与 app-key 只在进程内存里。
- **凭据来源**（`AccessResolver`，按顺序）：显式设置 `apiKey` → `DSH_OFFICEACE_API_KEY` → 本机登录态（`local-session`）。显式 Key 走 Bearer，本机登录态走 Basic。
- **模型目录**：`GET /v1/models` 发现并缓存到 `~/.dsh/dsh-connect-officeace.catalog.json`；上游不可达时回落缓存。目录里混有图像/视频/embedding/rerank 模型，按 id 启发式过滤（见 protocol §4）。
- **隔离**：只读写自己的设置命名空间与 `~/.dsh/dsh-connect-officeace.*.json`，不与其它插件共享账号、凭据、目录或开关。

## 安装

```
dsh plugin --profile desktop add <仓库路径>
```

`@deepseek-ai/*` 与 `@earendil-works/pi-ai` 为 peerDependencies，由 DSH 宿主提供，不打包。

## 设置面板

DSH 的设置页不会自动生成：`registerConfigurableProviders` 只把 provider 放进模型列表，左侧导航里的「设置 → OfficeAce」由插件自己的浏览器脚本注册 `settings.section` slot。

- 源码是手写的 `src/client.js`（CommonJS-shaped 普通脚本：`window.__ModuleLoader__.load({ id, factory })`，顶部不能出现 `import`，否则整个 web boot 会挂）。
- 构建时由 `scripts/copy-client.mjs` 复制到 `lib/client.js`（`lib/` 是 gitignore 的产物目录，所以这一步不能省）。
- 面板内容只走三条已存在的路由：`status`（登录状态、脱敏账号、到期时间、凭据来源、网关 baseUrl）、`catalog`（模型清单）、`__save`（只写 `enabledModelIds`）。**没有任何把凭据送到浏览器的字段。**
- `npm run verify:client` 做静态校验：CJS 形态、`require` 白名单、导出集合、`inject = ["slots","locale"]`、`settings.section` 注册、`package.json` 的 `exports["./client"]` 与 `dsh.client`、产物一致性。

改完源码后要重新构建并重新 `dsh plugin --profile desktop add file:<仓库路径>`（`file:` 是拷贝，不是链接），再重启 DSH 桌面端。

## 设置

设置 → OfficeAce。登录正常时全部留空即可。

| 字段 | 说明 |
|---|---|
| `enabledModelIds` | 勾选的模型 id；留空=展示全部，显式空数组=一个都不选。 |
| `apiKey` | 可选。填写后改用 Bearer，覆盖本机登录态。 |
| `baseUrl` | 可选。留空用本机解析出的 `https://<model_api_url_base>/v1`；仅在网关地址异常时覆盖。 |
| `installRoot` | 可选。OfficeAce 安装根目录；留空自动探测。 |
| `defaultContextWindow` | `/models` 不返回上下文长度时的默认值（推断值，默认 200000）。 |

状态卡还展示：本机是否登录、账号（脱敏）、过期时间、凭据来源（settings/env/local-session）、网关 baseUrl、目录来源。

## CLI 诊断

```
node lib/cli-doctor.js [--json] [--network] [--install-root <dir>] [--base-url <url>]
node lib/cli-probe.js [-p <prompt>] [-m <model>] [--tools] [--json] [--no-stream] [--timeout-ms N]
node lib/bin.js doctor | probe
```

- `doctor`：五项只读检查（安装 / 本地库 / 登录记录 / 凭据解析 / 网关），`--network` 才探测 `/v1/models`；**不消耗推理额度**；退出码 0/1/2。
- `probe`：真实流式对话一次（会消耗额度）；退出码 0/2/3/4/5/1。

真机 `doctor --network`（2026-11-16，OfficeAce 1.8.1）：

```
OK   install      找到 OfficeAce 本地状态库 data/storage.sqlite
OK   local-store  本地状态库可读（只读打开）
OK   session      已登录（provider=huawei-oauth，expiresAt=2026-11-16T15:12:35.397Z）
OK   credential   访问凭据已解析（来源：local-session，baseUrl：https://modelgw-0006.…/v1）
OK   upstream     模型网关 /v1/models 可用（38 个模型）
```

真机 `probe --tools --json`：`ok:true`，`model:"deepseek-v4-flash"`，`status:200`，usage 含 `reasoning_tokens:107`。

## 已知限制

- **受限沙箱里 Node 不能 spawn 子进程**（`spawn EPERM`）。此时凭据无法解析，`doctor` 会明确报 `powerShell_blocked`；可用 `DSH_OFFICEACE_PROVIDER_STATE_FILE=<已解码的 provider-state.json>` 做离线诊断（仅测试用，文件含凭据，用完即删）。DSH 宿主进程/普通终端不受此限制。
- 上下文窗口仍是假设值（见 protocol §4）。
- 上游可用模型因账号而异：OfficeAce 配置里的 `deepseek-v4.1-flash` 在本机账号上返回 404，实测可用的是 `deepseek-v4-flash`。

## 隐私

- 只读 OfficeAce 的本地状态库与当前用户的 Windows 凭据管理器；不写回、不复制到磁盘、不密封。
- app-key、STS token、refresh token 等**只存在于进程内存**；不进日志、不进错误消息、不进 web 路由响应、不进 loopback shim 响应。
- 账号 id `<orgId>:<userId>` 在所有视图里脱敏为 `43808e…:ce736e…`。
- web 路由先过宿主 Connection 的 `requestRejection`，再叠 loopback Host/Origin + `sec-fetch-site` 门禁；写路由额外要求 `x-dsh-officeace-write` 头。
- 仓库不含任何凭据、账号、余额或截图。

## 开发

```
npm install
npm run check     # typecheck + test + build
npm run doctor
npm run e2e       # 端到端：本机登录 → 凭据 → 网关 → shim → 对话/流式/工具调用
```

测试：`tsc -p tsconfig.test.json && node scripts/test.mjs`（67 条，单进程跑，原因见 DEVELOPMENT.md）。

`npm run e2e` 打真实网关、会消耗少量额度（单次跑下来不到 1000 token），只在已登录 OfficeAce 的机器上跑；它不使用 `DSH_OFFICEACE_PROVIDER_STATE_FILE` 之类的旁路，凭据来源必须是 `local-session`。

## License

MIT
