# OfficeAce 接入依据

本文件回答一件事：**这个插件里哪些说法有据可依，哪些是推断，哪些根本没做。**

证据分三级，正文里逐条标注：

- **【实测】** — 2026-11-16 在装有 OfficeAce 1.8.1 的本机（Windows x64）上直接读到或调用到的：注册表项、安装目录文件、`data/storage.sqlite`、Windows 凭据管理器里的 provider state、以及对模型网关的真实 HTTP 调用。
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

### 1.2 本地状态库【实测】

`<安装根>\data\storage.sqlite` 是 Redis 形状的键值库（`oc_kv_string` / `oc_kv_hash` / `oc_kv_set` / `oc_kv_zset` / `oc_kv_keys`）。本插件只读 `oc_kv_string`。

登录记录（键前缀 `office-claw:oc:session:user:`），真实形状（值已脱敏）：

```json
{"sessionId":"<uuid>","providerId":"huawei-oauth",
 "userId":"<orgId>:<userId>","displayName":"<name>",
 "createdAt":"<iso>","lastSeenAt":"<iso>","expiresAt":"<iso>",
 "persist":true,"accountMode":"personal","needsReauth":false,
 "providerStateRef":"wincred://OfficeAce/auth-sessions/huawei-oauth/<org>:<user>/provider-state"}
```

本地 API 服务租约（键 `office-claw:runtime:api-instance-lease:v1`）含 `token` / `apiPort` / `pid` / `appVersion` 等字段。插件只据此判断「本机是否登录」「是否过期」「桌面端是否在跑」。

### 1.3 登录态在 Windows 凭据管理器里，而且可读【实测】

`providerStateRef` 去掉 `wincred://` 就是凭据管理器里的 target：

```
OfficeAce/auth-sessions/huawei-oauth/<orgId>%3A<userId>/provider-state
```

本机实测（`CredEnumerate` + `CredRead`，LegacyGeneric）共 7 条：

- manifest 凭据：上面那个 target，186 字节，UTF-16LE 编码的 JSON
  `{"schemaVersion":2,"encoding":"base64","storageId":"<12 hex>","chunkCount":6}`
- 分块凭据：`<target>/chunks/<storageId>/<0..5>`，每块 UTF-16LE 文本（约 1000 个 base64 字符，末块 956）

**解码链路**：把 6 个分块按序号拼接成一段 base64 → 解码 → UTF-8 JSON（本机 4465 字节）。`CredRead` 自己完成了 DPAPI 解密，插件既不碰 DPAPI、也不编译原生模块。

解码后的结构（键名实测，值已删）：

```
schemaVersion: 1
providerState:
  authType: "huawei-oauth"
  accountId / user_id: <32 hex>
  userName: <display name>
  modelInfo:
    model_api_url_base: "modelgw-0006.officeace.cn-southwest-2.huaweicloud-agentarts.com"
    model_auth_info:
      model_app_key: <32 hex>
      model_app_secret: <32 hex>
  credential:    { access, secret, sts_token, project_id, expires_at, refresh_token, refresh_expires_at }
  credentialV3:  { access, secret, sts_token, project_id, expires_at }
  dpop:          { privateJwk, publicJwk }   ← 该账号同时持有 DPoP 密钥对
  traceInfo:     { appTraceToken, apmApiUrlBase }
  cloudServices: { activatedServices, ocr, … }
```

`dpop` 的存在只作记录：模型网关鉴权没有用到它（见 §2）。

## 2. 模型网关：地址、鉴权、路径【实测】

### 2.1 地址

`modelInfo.model_api_url_base` 是**主机名（无 scheme）**，实测为
`modelgw-0006.officeace.cn-southwest-2.huaweicloud-agentarts.com`（AWS 中国宁夏区，解析到华为云 APIG）。模型 API 基址为 `https://<该主机>/v1`。

### 2.2 鉴权

对同一路径试过多组候选，只有一组通过：

| 尝试 | 结果 |
|---|---|
| `Authorization: Bearer <credential.access>` | 401 `APIG.0303` |
| `Authorization: Bearer <sts_token>`（v2 / v3） | 401 `APIG.0303` |
| `X-Auth-Token: <sts_token>` | 401 `APIG.0303` |
| `X-Apig-Appcode: <model_app_key>` | 401 `APIG.0303` |
| `Authorization: SDK-HMAC-SHA256 Access=<model_app_key>` | 401 `APIG.0303` |
| **`Authorization: Basic base64(<model_app_key>:<model_app_secret>)`** | **200** |

所以：**网关用 app-key 对做 HTTP Basic**，不是 IAM/STS 签名，也不是 AppCode。`credential.access/secret/sts_token` 与 `credentialV3.*` 存在但本插件不用于模型调用。

### 2.3 路径

| 请求 | 结果 |
|---|---|
| `GET  /` | 404 `APIG.0101`（未发布） |
| `GET  /v1/models` | 200，`{"object":"list","data":[…]}` |
| `GET  /models` | 404 `APIG.0101` |
| `POST /v1/chat/completions` | 200（`deepseek-v4-flash`） |
| `POST /inference/v1/chat/completions` | 404 |

即：**`/v1/models` + `/v1/chat/completions` 是实测可用路径**。网关会在错误里回显它内部路由到的 `/inference/v1/chat/completions`，那是实现细节，不是对外路径。

### 2.4 模型可用性

`GET /v1/models` 实测返回 38 条，字段只有 `id` / `object` / `created` / `owned_by`，**没有上下文长度、没有能力标记**，且混着 chat / 图像 / 视频 / embedding / rerank 模型。

两个值得记的实测结果：

- `deepseek-v4.1-flash`（OfficeAce 自己 agent 配置里的 defaultModel）→ **404** `ModelArts.81016 The model … is not available with api url /inference/v1/chat/completions`
- `deepseek-v4-flash` → **200**，正常返回

全量实测（2026-11-16，本机账号）：对目录里 20 条 chat id 逐个发 `max_tokens:8` 的最小补全，**只有 6 条返回 200**：`deepseek-v4-flash`、`glm-5.3`、`glm-5.2`、`glm-5.1`、`deepseek-v4.1-flash-0930`、`deepseek-v4-flash-0731`。其余 14 条失败：`ModelArts.81009 Invalid model`（模型名在该网关不存在）、`ModelArts.81016 … not available with api url`（存在但当前 api url 不提供）、`ModelArts.81004 … you do not have access to it`（无权限）三类都有。目录里另有 18 条图像/视频/embedding/rerank 模型被名称启发式过滤掉。

所以「列在 `/v1/models` 里」不等于「这个账号能调用」。插件据此：

- `MEASURED_USABLE_MODEL_IDS` 记这 6 条，**未勾选任何模型时选择器只列它们**（顺序把实测默认 `deepseek-v4-flash` 排最前）；
- 账号没有这 6 条中任何一条时回退到整个目录，避免选择器变空；
- 设置里勾选 `enabledModelIds` 后以勾选为准（用户自己的账号可能开通了别的模型）。

## 3. 对话协议【实测】

`POST /v1/chat/completions`，`stream: true`，`stream_options:{include_usage:true}`：

- 响应 `text/event-stream; charset=utf-8`；
- `delta.reasoning_content` 有增量（实测一次回复 80 个 reasoning chunk）；
- `delta.content` 正文增量；
- 带 `tools` 时 `delta.tool_calls` 有增量（实测 1 个 tool-call chunk）；
- 末尾有 usage chunk（`prompt_tokens` / `completion_tokens` / `completion_tokens_details.reasoning_tokens`）；
- 终止符 `data: [DONE]`。

结论：OfficeAce 网关是**原生 OpenAI 兼容**，工具调用与思考链都走标准字段，shim 不需要协议转换。这一条从 0.2.0 起是实测，不再是「只承诺字节透传」。

## 4. 上下文窗口【推断】

`/v1/models` 不返回上下文长度（实测字段只有 `id/object/created/owned_by`），而 DSH 会因为任何一个模型缺 `contextWindow` 而拒绝整个 provider（`INVALID_MODEL_CONTEXT`）。所以：

- 响应里带 `context_length` / `context_window` / `contextWindow` → 用之；
- 否则用 `defaultContextWindow`，默认 200000，**可在设置里改**。

默认值仍是**假设**，不是实测；`maxTokens` 同理（默认 32000）。这是本仓库唯一保留的「为了能跑而做的推断」，已写在 README 与 schema 描述里。

## 5. 明确没做的（不要算完成）

| 能力 | 为什么不做 |
|---|---|
| 用量 / 积分 / 余额看板 | 没有找到可验证的 OfficeAce 用量接口。`credential` / `credentialV3` 里只有 STS 凭据与过期时间，没有任何余额或流水字段；参考实现的积分接口是 Loomy / Trae 各自的，不能套用。 |
| 每日签到 / 领取 | 同上，且属于写操作。 |
| 模型管理 UI、多区域 provider、账号池 | 参考实现的这些能力建立在各自已知的区域与端点之上；OfficeAce 侧只确认了一个网关主机。 |
| DPoP / IAM 签名通道 | 账号里有 `dpop.privateJwk` 与 STS 凭据，但模型网关只吃 Basic app-key；没有证据表明模型调用需要它们。 |

## 6. 可复现的验证

本机实际执行（非声明）：

```
$ npm run check
typecheck → exit 0
tests     → 67 / 67 pass
build     → exit 0

$ node lib/cli-doctor.js --network      # 凭据由本机登录态解析
OK   install      找到 OfficeAce 本地状态库 data/storage.sqlite
OK   local-store  本地状态库可读（只读打开）
OK   session      已登录（provider=huawei-oauth，expiresAt=2026-11-16T15:12:35.397Z）
OK   credential   访问凭据已解析（来源：local-session，baseUrl：https://modelgw-0006.…/v1）
OK   upstream     模型网关 /v1/models 可用（38 个模型）
exit 0

$ node lib/cli-probe.js --tools --json
{"ok":true,"model":"deepseek-v4-flash",
 "baseUrl":"https://modelgw-0006.….huaweicloud-agentarts.com/v1",
 "status":200,
 "usage":{"prompt_tokens":288,"completion_tokens":124,
          "completion_tokens_details":{"reasoning_tokens":107}}}
exit 0
```

关于 wincred 通道的验证边界（如实记录）：

- 交付的 PowerShell 读取程序（`buildReadScript` 产出的那段）在本机 PowerShell 里**真跑通过**：manifest → 6 个分块 → 拼出 base64 → 解码出 4465 字节 JSON，字段与 §1.3 一致。
- Node 侧解码器用**同一次真实抓取的 envelope** 验证通过（`DECODE_OK`，host / appKey / expiresAt 都对得上）。
- 但本次 agent 运行在 Windows 沙箱里，**Node 不允许 spawn 带管道 stdio 的子进程**（`spawn EPERM`）。所以 `probe` 的端到端那一次，凭据走的是 `DSH_OFFICEACE_PROVIDER_STATE_FILE` 注入已解码的 provider state（文件仅存在于 `.evidence/`，跑完即删）。**wincred → Node 的默认链路在沙箱内无法执行，在 DSH 宿主进程/普通终端里不受此限制。**

测试覆盖：路径推导、sqlite 只读解析、会话过期/脱敏、凭据优先级与缓存、wincred manifest/分块解码、目录归一化与非 chat 过滤、设置原子写、上游错误分类、shim 鉴权与 SSE 透传、路由门禁与 CSRF。

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
