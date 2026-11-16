# 开发说明

## 命令

```
npm install
npm run typecheck      # tsc -p tsconfig.json（noEmit）
npm test               # tsc -p tsconfig.test.json && node scripts/test.mjs
npm run build          # tsc -p tsconfig.build.json → lib/
npm run check          # 上面三件一起
node lib/cli-doctor.js [--json] [--network]
node lib/cli-probe.js  [-p <prompt>] [-m <model>] [--tools] [--json]
```

## 为什么是 tsc 而不是 tsdown

两个参考实现用 tsdown，是因为它们带客户端 UI（`src/client/*.tsx`）需要单独打包。本仓库没有客户端产物：设置卡片由宿主按 schemastery schema 渲染，服务端代码 `tsc` 直出 ESM + `.d.ts` 即可。少一个构建期依赖，也少一处版本漂移。

差异是刻意的，不是遗漏。

## 为什么测试是单进程

`node --test <dir>` 会为每个测试文件 spawn 一个子进程。在 Windows 沙箱里，子进程的 piped stdio 会被拒绝（`spawn EPERM`），于是整套测试在「启动子进程」这一步就失败。

`scripts/test.mjs` 把编译后的 `out-test/*.test.js` 依次 `import` 进当前进程：`node:test` 仍然收集、执行并报告，失败时仍然把退出码置 1，但没有子进程。

## node:sqlite

本地状态库用内置 `node:sqlite` 读（Node 22.19+/24），只读打开。运行时会打印一次：

```
ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

这是 Node 的提示，不是插件问题。CI 里同样会出现。

## 浏览器端（设置面板）

`src/client.js` 是手写的普通脚本，不是 TS、也不是 ES module：

- 必须保持 CJS-shaped：`window.__ModuleLoader__.load({ id, factory })`，顶部不能有 `import`/`export`，否则整个 web boot 会挂。
- `require` 只能用宿主注入的两个：`react`、`react/jsx-runtime`（由 `dsh.client.inject` 映射）。
- 构建时 `scripts/copy-client.mjs` 复制到 `lib/client.js`；`lib/` 是 gitignore 的产物，所以**改完必须重新 build**。
- `npm run verify:client` 静态校验它（形态、导出、slot、package.json 契约、路由白名单）。
- 装的是 `file:` 拷贝：改完要重新 `dsh plugin --profile desktop add file:<仓库路径>`，再重启 DSH。

## 凭据解析与 wincred

凭据来源顺序：设置 `apiKey` → 环境 `DSH_OFFICEACE_API_KEY` → 本机 OfficeAce 登录态。

本机登录态这条链路是：本地 sqlite 的 session 记录拿 `providerStateRef` → 去掉 `wincred://` 得凭据 target → PowerShell 里 `CredRead` 读 manifest 与分块 → 拼接 base64 → 解码 JSON → 取 `modelInfo.model_api_url_base` 与 `model_auth_info` 的 app-key 对。`CredRead` 自己完成 DPAPI 解密，不需要原生模块。

读凭据要 spawn 一个 `powershell.exe`。**DSH 宿主进程或普通终端可以；受限沙箱会拒绝管道子进程（`spawn EPERM`）**，此时 `doctor` 报 `powerShell_blocked`。若要在受限环境里验证下游链路，可注入一份已解码的 provider state：

```powershell
$env:DSH_OFFICEACE_PROVIDER_STATE_FILE = 'C:\path\to\provider-state.json'
node lib/cli-probe.js --tools
```

该变量只是离线诊断入口，不是生产凭据来源——那个文件里是明文 token，用完立刻删。

## 对着真实安装调试

```powershell
$env:DSH_OFFICEACE_APP_ROOT = 'C:\Users\<user>\AppData\Local\Programs\OfficeAce'
node lib/cli-doctor.js --json
```

`doctor` 的五项检查里，`credential` 会尝试解析本机登录态；解析失败时它会给出失败原因（例如沙箱里的 `powerShell_blocked`），这是真实状态，不是可以「修绿」的 bug。要验证上游：

```powershell
node lib/cli-probe.js --tools
```

成功会打印模型输出并以 0 退出；401/403 → 3，网络 → 4，其它上游错误 → 5。

## 目录

```
src/
  index.ts        插件入口（Config schema、provider 注册、路由装配）
  adapter.ts      pi-ai provider + 跨版本 context 折叠
  shim.ts         loopback HTTP shim
  upstream.ts     OpenAI 兼容上游客户端
  catalog.ts      模型行归一化 → pi-ai descriptor
  discovery.ts    /models 发现 + 缓存
  local-store.ts  只读 sqlite 读取
  session.ts      会话解析 / 过期 / 脱敏
  credentials.ts  凭据解析（settings > env）
  store.ts        插件设置文件（原子写）
  routes.ts       status / catalog / save
  cli-doctor.ts   只读体检
  cli-probe.ts    真实流式探测
  bin.ts          子命令分发
tests 与源码同目录：src/*.test.ts
```

## 改动时最常踩的坑

1. **`baseUrl` 必须带 `/v1`**：pi-ai 把它当 OpenAI SDK 的 `baseURL`，原样追加 `/chat/completions`；少 `/v1` 会 404。
2. **模型行必须有正整数 `contextWindow`**：DSH 会因为一个模型不合法而拒绝整个 provider。
3. **`enabledModelIds` 的「缺省」与「空数组」是两种状态**：`undefined` 表示未配置（展示全部），`[]` 表示用户全不选。写设置时不要把前者归一成后者。
4. **不要在 shim 或路由响应里回显任何凭据或完整账号 id**：`session.test.ts` 与 `upstream.test.ts` 有对应断言。
