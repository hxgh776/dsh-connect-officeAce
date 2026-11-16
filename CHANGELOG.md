# Changelog

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
