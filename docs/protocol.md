# OfficeAce 接入依据

本文件回答一件事：**这个插件里哪些说法有据可依，哪些是推断，哪些根本没做。**

证据分三级，正文里逐条标注：

- **【实测】** — 2026-11-16 在装有 OfficeAce 1.8.1 的本机（Windows x64）上直接读取到的：注册表项、安装目录文件、`data/storage.sqlite` 的表与记录、随包 `.env` 与 `office-claw-config.json`、随包 JS bundle 里的字符串。
- **【参考】** — 来自两个参考实现的已验证做法：本机 `/d/software/dsh-plugin/dsh-connect-loomy`，以及 `dingminhua/dsh-connect-trae`（main，tarball 提交树 `7788c45`）。这类证据只对 **DSH 侧机制**成立，**不构成 OfficeAce 上游事实**。
- **【推断】** — 没有直接证据。凡是对外行为有影响的推断，都做成了可配置项或明确不实现，不在代码里伪装成事实。

---

## 1. 安装与本地状态

### 1.1 安装位置【实测】

注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\OfficeAce`：

```
DisplayName     : OfficeAce
DisplayVersion  : 1.8.1
Publisher       : Huawei Cloud
InstallLocation : C:\Users\<user>\AppData\Local\Programs\OfficeAce
```

安装根目录下可见 `OfficeAce.exe`、`OfficeAceServiceHost.exe`、`resources/app.asar`、`data/`、`packages/`、`office-claw-config.json`、`.env`。

### 1.2 本地状态库【实测】

`<安装根>\data\storage.sqlite` 是 Redis 形状的键值库（`oc_kv_string` / `oc_kv_hash` / `oc_kv_set` / `oc_kv_zset` / `oc_kv_keys`），另有 `oc_draft_*` 草稿表。本插件只读 `oc_kv_string`。

登录记录（键前缀 `office-claw:oc:session:user:`），真实形状（值已脱敏）：

```json
{"sessionId":"<uuid>","providerId":"huawei-oauth",
 "userId":"<orgId>:<userId>","displayName":"<name>",
 "createdAt":"<iso>","lastSeenAt":"<iso>","expiresAt":"<iso>",
 "persist":true,"accountMode":"personal","needsReauth":false,
 "providerStateRef":"wincred://OfficeAce/auth-sessions/huawei-oauth/<org>:<user>/provider-state"}
```

本地 API 服务租约（键 `office-claw:runtime:api-instance-lease:v1`）：

```json
{"version":1,"token":"<uuid>","instanceId":"api-<uuid>","pid":<n>,
 "hostname":"<host>","apiPort":3004,"appVersion":"1.8.1",
 "startedAt":<ms>,"acquiredAt":<ms>,"supervisorPid":<n>,"supervisorId":"<hex>"}
```

插件据此判断「本机是否登录」「登录是否过期」「桌面端是否在跑」，**不读取 token 本身**。

### 1.3 token 到底在哪【实测 + 未实现】

`providerStateRef` 是 `wincred://OfficeAce/auth-sessions/...` —— Windows 凭据管理器。同一安装目录下另有：

- `packages/api/.config/secure-config-nodejs/oauth-<org>%3A<user>.json`：`{version, alg:"aes-256-gcm", iv, tag, data}`；
- `packages/api/.config/secure-config-nodejs/.oauth-profile-encryption-key`：以 `OC-DPAPI-1` 开头、DPAPI 包裹的密钥；

APIs 还依赖 `@napi-rs/keyring` / `cross-keychain`。结论：**登录 token 需要 DPAPI/原生凭据 API 才能取出，本插件没有实现**。这是「复用本机登录」没做成的直接原因，不是遗漏。

## 2. 上游地址

### 2.1 随包 `.env`【实测】

```
OFFICE_CLAW_API_HOST            = https://api.office-claw.com
OFFICE_CLAW_API_URL             = http://localhost:3004        # 本地 API 服务
NEXT_PUBLIC_PROD_API_URL        = office-claw.com
NEXT_PUBLIC_PROD_FRONTEND_HOST  = app.office-claw.com
OFFICE_ACE_USER_PROFILE_ENDPOINT= https://officeace.chat.huaweicloud-agentarts.com
OFFICE_CLAW_SKIP_AUTH           = 0
```

### 2.2 模型访问方式【实测（bundle 字符串）+ 推断（公开基址）】

随包 `packages/api/dist/index.js`（`@openjiuwen/relay-api-server`）里：

- provider profile 校验：`client "relayclaw" ("jiuwen") requires an API key provider profile`，且 `protocol === "openai"`；
- 调用形态：`POST ${baseUrl}/chat/completions`，头 `Authorization`；
- 本地路由：`/api/maas-models`（MaaS 模型清单），`Authorization: Bearer …` 或 `x-office-claw-session`；
- `effectiveProtocol === "huawei_maas"` 分支存在，说明 OfficeAce 的模型来自华为 MaaS。

**【推断】** 公开的 OpenAI 兼容基址是 `https://api.office-claw.com/v1`，其上存在 `GET /models`。**没有做过一次真实调用**，所以它是 `baseUrl` 的默认值而不是硬编码事实。

### 2.3 本地 API 服务未打通【实测】

`api-instance-lease` 显示服务在 `127.0.0.1:3004` 上运行，`Test-NetConnection` 显示端口开放；但用 `curl -v` 直接请求 `/api/maas-models`、`/`、`/healthz` 均得到 *Empty reply from server*（带 `x-office-claw-session` 或 `Authorization` 亦然），Windows 侧 `Invoke-WebRequest` 同样被重置。

**结论：本插件不依赖本地 API 服务。** 依赖它会把插件的可用性绑在一个当前无法验证的通道上；记录在这里，供后续排查。

## 3. 对话协议

**【参考】** DSH 侧链路（pi-ai → loopback shim → 上游）来自 `dsh-connect-loomy` 的实测：OpenAI 兼容 SSE、`delta.reasoning_content`、`delta.tool_calls`、usage chunk、`data: [DONE]`，以及「`baseUrl` 必须带 `/v1`，因为 pi-ai 会原样追加 `/chat/completions`」。

**【实测】** OfficeAce 侧只核到：路径 `/chat/completions`、`Authorization` 鉴权、`protocol: "openai"`。**没有核到**它实际返回的 SSE 字段。

因此本插件的承诺只有一条：**OpenAI 兼容字节透传**。`reasoning_content` / `tool_calls` 若有则原样穿过（测试覆盖了透传路径），但插件不声称 OfficeAce 一定产出它们。这一条在 `README.md` 的能力表里标的是「已实现，未端到端验证」。

## 4. 模型目录与上下文窗口

**【实测】** `office-claw-config.json` 里各 agent 的默认模型：

- `office` / `assistant` / `agentteams`：`defaultModel = "deepseek-v4.1-flash"`，`providerProfileId = "huawei-maas"`；
- `agentteam`：`defaultModel = "deepseek-v4.1-flash-1017"`。

这两个 id 是**唯一能核实**的模型；代码里作为 `KNOWN_MODEL_IDS` 仅用于诊断，不冒充可选的完整目录。

**【推断】** `/models` 的响应结构未知，尤其**没有证据表明它返回上下文长度**。DSH 会因为某个模型缺 `contextWindow` 而整体拒绝 provider（`INVALID_MODEL_CONTEXT`），所以：

- 若响应带 `context_length` / `context_window` / `contextWindow` → 用之；
- 否则用 `defaultContextWindow`，默认 200000，**可在设置里改**。

这是本仓库最大的一个「为了能跑而做的假设」，明确写在 schema 描述与 README 里。`maxTokens` 同理，默认 32000。

## 5. 明确没做的（不要算完成）

| 能力 | 为什么不做 |
|---|---|
| 复用本机登录态（免 API Key） | token 在 Windows 凭据管理器 + DPAPI 包裹的加密密钥；纯 Node 读不到，做成半吊子会假装成功。 |
| 用量 / 积分 / 余额看板 | 没有找到可验证的 OfficeAce 用量接口。参考实现里的积分接口是 Loomy 与 Trae 各自的，不能套用。 |
| 每日签到 / 领取 | 同上，且属于写操作，臆造接口风险更高。 |
| 模型管理 UI、多区域 provider、账号池 | 参考实现的这些能力建立在各自已知的区域与端点之上；OfficeAce 侧无对应证据。 |
| 端到端对话验证 | 缺一个可用的上游凭据；`probe` 已写好，填 Key 即可验证。 |

## 6. 可复现的验证

本机实际执行（非声明）：

```
$ npm run typecheck
> tsc -p tsconfig.json
（exit 0）

$ npm test
> tsc -p tsconfig.test.json && node scripts/test.mjs
ℹ tests 50
ℹ pass 50
ℹ fail 0

$ npm run build
> tsc -p tsconfig.build.json
（exit 0）

$ node lib/cli-doctor.js
OK   install      找到 OfficeAce 本地状态库 data/storage.sqlite
OK   local-store  本地状态库可读（只读打开）
OK   session      已登录（provider=huawei-oauth，expiresAt=2026-11-16T15:12:35.397Z）
FAIL credential   未配置上游 API Key。OfficeAce 的登录 token 存放在 Windows 凭据管理器…
OK   upstream     跳过（加 --network 探测上游 /models）
（exit 1 —— credential 是真实缺口）
```

测试覆盖的是可离线判定的部分：路径推导、sqlite 只读解析、会话过期/脱敏、目录归一化、设置文件原子写、凭据优先级、上游错误分类、shim 鉴权与 SSE 透传、路由门禁与 CSRF。
**不覆盖**：真实 OfficeAce 上游的任何一次调用（没有凭据）。

## 7. 参考实现清单（用于核对）

| 事实 | 参考来源 |
|---|---|
| Cordis 插件入口（`inject:["llm"]`、`registerAdapter`、`registerConfigurableProviders`） | loomy `lib/index.js`；trae `src/index.ts` |
| loopback shim（随机端口、`timingSafeEqual`、Host/Origin 门禁、64MB、SSE 看门狗） | loomy `lib/loomy-shim.js` |
| pi-ai 跨版本 context 折叠（legacy/modern 检测） | loomy `lib/loomy-adapter.js`（其注释注明来自 trae） |
| 设置文件自持 + 原子写 | loomy `lib/loomy-store.js` |
| web 路由先过 Connection `requestRejection` | loomy `lib/loomy-routes.js` |
| provider 注册的产品形态（设置页、模型勾选、只读状态卡） | trae `README.md` / `src/index.ts` |

这些是「怎么做 DSH 插件」的证据，不是「OfficeAce 是什么」的证据。
