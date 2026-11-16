# DSH Connect OfficeAce

把本机安装并登录的 [OfficeAce](https://www.office-claw.com)（华为云）桌面端接入 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness)：OfficeAce 的模型出现在 DSH 模型选择器，OpenAI 兼容请求经进程内 loopback shim 转发到上游，`bash` / `read` / `write` / `edit` 等工具仍由 DSH 本地执行。

架构与工程约定参照 `dsh-connect-trae`（远端）与 `dsh-connect-loomy`（本机）。

> **先读这一条：这个仓库目前是「骨架 + 已核实事实」，不是端到端可用的成品。**
> DSH 侧的机制（provider 注册、loopback shim、pi-ai 适配、设置页、路由）是从两个参考实现里搬来的成熟做法；
> OfficeAce 侧的**登录态复用**和**用量看板**没有做成，因为证据不足，而不是没来得及写。
> 逐条依据与缺口见 [docs/protocol.md](docs/protocol.md)，下面的「完成度」表是它的摘要。

## 完成度

| 能力 | 状态 | 依据 |
|---|---|---|
| DSH provider 注册 / 模型选择器 | ✅ 已实现 | 参考实现（两个参考仓库同款机制） |
| loopback shim（随机端口 + 进程内 secret + 流式透传） | ✅ 已实现，有测试 | 参考实现 |
| pi-ai 适配 + 跨版本 context 折叠 | ✅ 已实现 | 参考 `dsh-connect-loomy` / `dsh-connect-trae` |
| 读取本机 OfficeAce 登录记录（只读诊断） | ✅ 已实现，真机跑通 | **实测**：`data/storage.sqlite` 的 `oc_kv_string` |
| 上游 OpenAI 兼容对话 | ⚠️ 已实现，**未端到端验证** | 端点推断，需 API Key |
| 复用 OfficeAce 本机登录态（免 Key） | ❌ 未实现 | token 在 Windows 凭据管理器，需 DPAPI/原生 API |
| 用量 / 积分看板 | ❌ 未实现 | 未找到可验证的查询接口 |
| 每日签到、模型管理、多区域面板 | ❌ 不在范围 | 无证据，不臆造 |

`✅` 的部分有真实测试覆盖（50 条，见下文）；`⚠️` 的部分有代码但缺一次真实上游调用；`❌` 的部分只进文档，不进代码。

## 前提

- 先安装并登录 OfficeAce 桌面端（插件不做登录，也绝不代登录）。
- Windows x64。插件读取 OfficeAce 安装目录下的本地状态库；其它平台没有这个布局。
- **模型访问凭据需要单独提供**：OfficeAce 把 oauth token 放在 Windows 凭据管理器（`wincred://OfficeAce/...`），本插件没有实现读取，所以在 DSH 设置里填 API Key，或用环境变量 `DSH_OFFICEACE_API_KEY`。

## 工作方式

```
DSH pi-ai provider (openai-completions)
  → 进程内 loopback shim（127.0.0.1 随机端口 + 进程内随机 secret）
    → OfficeAce OpenAI 兼容上游（默认 https://api.office-claw.com/v1，可覆盖）
```

- **本机状态**：只读打开 `%LOCALAPPDATA%\Programs\OfficeAce\data\storage.sqlite`，读两条记录——当前登录账号与本地 API 服务租约。不写入、不迁移、不复制 token。
- **凭据**：来自本插件自己的设置文件或 `DSH_OFFICEACE_API_KEY`；不写日志、不进 web 路由响应、不落进 loopback shim 的响应。
- **模型目录**：从上游 `/models` 发现并缓存到 `~/.dsh/dsh-connect-officeace.catalog.json`；上游不可达时回落缓存，不提供内置假目录（原因见 protocol §4）。
- **隔离**：只读写 `dsh-connect-officeace` 自己的设置命名空间与 `~/.dsh/dsh-connect-officeace.*.json`，不与其它插件共享账号、凭据、目录或开关。

## 安装

```
dsh plugin --profile desktop add <仓库路径>
```

`@deepseek-ai/*` 与 `@earendil-works/pi-ai` 为 peerDependencies，由 DSH 宿主提供，不打包。

## 设置

设置 → OfficeAce：

| 字段 | 说明 |
|---|---|
| `apiKey` | 上游 API Key（也可用 `DSH_OFFICEACE_API_KEY`）。 |
| `baseUrl` | 上游地址覆盖；留空用 `https://api.office-claw.com/v1`（推断值）。 |
| `installRoot` | OfficeAce 安装根目录；留空自动探测。 |
| `enabledModelIds` | 勾选的模型 id；留空=展示全部，显式空数组=一个都不选。 |
| `defaultContextWindow` | `/models` 未给上下文长度时使用的值（推断值，默认 200000）。 |

设置页同时展示只读状态：本机是否登录、账号（脱敏）、过期时间、token 实际存放位置、目录来源、凭据来源。

## CLI 诊断

```
node lib/cli-doctor.js [--json] [--network] [--install-root <dir>] [--base-url <url>]
node lib/cli-probe.js [-p <prompt>] [-m <model>] [--tools] [--json] [--no-stream] [--timeout-ms N]
node lib/bin.js doctor | probe
```

- `doctor`：五项检查（安装/本地库可读/登录记录/凭据/上游），**不消耗推理额度**；退出码 0/1/2。
- `probe`：真实流式对话一次，会消耗额度；退出码 2/3/4/5/1/0。

真机 `doctor` 输出（2026-11-16，本机 OfficeAce 1.8.1）：

```
OK   install      找到 OfficeAce 本地状态库 data/storage.sqlite
OK   local-store  本地状态库可读（只读打开）
OK   session      已登录（provider=huawei-oauth，expiresAt=…）
FAIL credential   未配置上游 API Key。OfficeAce 的登录 token 存放在 Windows 凭据管理器（wincred://）中…
OK   upstream     跳过（加 --network 探测上游 /models）
```

`credential` 那一行 FAIL 是**真实状态**，不是 bug。

## 隐私

- 只读 OfficeAce 的本地状态库；不复制、不写回、不密封 token。
- 账号 id `<orgId>:<userId>` 在一切视图里脱敏成 `43808e…:ce736e…`；完整 id 不进日志、不进路由响应。
- web 路由先过宿主 Connection 的 `requestRejection`，再叠加 loopback Host/Origin + `sec-fetch-site` 门禁；写路由额外要求 `x-dsh-officeace-write` 头（CSRF）。
- 仓库不含任何凭据、账号、余额或截图；`docs/protocol.md` 里的值都是形状，不是本机实际值。

## 开发

```
npm install
npm run check     # typecheck + test + build
npm run doctor
```

测试：`tsc -p tsconfig.test.json && node scripts/test.mjs`（50 条，单进程跑，见 DEVELOPMENT.md 说明）。

## 依据

所有 OfficeAce 侧关键结论都标了证据等级（实测 / 参考实现 / 推断），见 [docs/protocol.md](docs/protocol.md)。

## License

MIT
