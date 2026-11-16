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

## 对着真实安装调试

```powershell
$env:DSH_OFFICEACE_APP_ROOT = 'C:\Users\<user>\AppData\Local\Programs\OfficeAce'
node lib/cli-doctor.js --json
```

`doctor` 的五项检查里，`credential` 在未配置 Key 时必然是 FAIL —— OfficeAce 的登录 token 在 Windows 凭据管理器，插件读不到（见 `docs/protocol.md` §1.3）。这不是可以「修绿」的项，除非实现凭据读取。

要验证上游，填一个可用的 Key：

```powershell
$env:DSH_OFFICEACE_API_KEY = '<key>'
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
