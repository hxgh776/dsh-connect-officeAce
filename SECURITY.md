# 安全与隐私

本插件接触本机 OfficeAce 的状态，所以边界写清楚。

## 不变量

1. **不代登录、不复制 token。** 插件只读 OfficeAce 本地状态库里的账号记录与会话元数据；token 本体在 Windows 凭据管理器（`wincred://OfficeAce/...`），本插件不读取。
2. **模型凭据只在内存与请求头里。** API Key 来自设置文件或 `DSH_OFFICEACE_API_KEY`；它不会进入日志、错误消息、web 路由响应或 loopback shim 的响应体。
3. **完整账号 id 不出现在任何视图里。** `<orgId>:<userId>` 在 status/doctor 中脱敏为 `43808e…:ce736e…`。
4. **仓库不含真实数据。** 无凭据、无账号、无余额、无截图；`docs/protocol.md` 只描述形状，值已脱敏。

## 攻击面

- **loopback shim**：只绑 `127.0.0.1` 的临时端口；每进程随机 secret，`timingSafeEqual` 比较且先比长度；Host 必须是 loopback，Origin 若存在也必须是 loopback；请求体上限 64 MB；上游流 300s 空闲即中止。
- **web 路由**：先过宿主 Connection 的 `requestRejection`（Host/Origin + 浏览器凭据），再叠 loopback Host、`sec-fetch-site: cross-site` 拒绝、loopback Origin；写路由额外要求 `x-dsh-officeace-write` 头。
- **设置文件**：`~/.dsh/dsh-connect-officeace.catalog.json` 与 `.settings.json`，原子写（临时文件 + rename）；读取只接受白名单字段，手改文件无法注入未知键。
- **本地状态库**：只读打开（`readOnly: true`），读完立即关闭；不建表、不迁移、不加锁。

## 已知风险

- **设置文件里的 API Key 是明文**（与宿主设置文件同等暴露面）。更安全的用法是只设 `DSH_OFFICEACE_API_KEY` 环境变量、不填设置。
- 上游地址 `baseUrl` 可被用户改成任意地址；这是显式配置项，插件不做域名白名单，因为 OfficeAce 的部署形态（公有云 / 私有化）未知。

## 报告

发现安全问题请开 issue，不要在公开渠道贴 token、账号 id 或凭据文件的原始内容；附形状（长度、前缀）即可。
