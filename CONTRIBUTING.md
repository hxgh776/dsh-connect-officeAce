# 仓库守则（CONTRIBUTING）

给在这个仓库里干活的人和 AI 助手看的一页。两件事：**别把推断写成事实**、**改完必须验证**。

> 运行环境会在工作目录根放一份自动管理的 `AGENTS.md`（Multica runtime 生成，不归本仓库所有，已在 `.gitignore` 里排除）。仓库自己的约定放在这里。

## 一、证据纪律

`docs/protocol.md` 把每条 OfficeAce 结论标成【实测】/【参考】/【推断】。改动涉及 OfficeAce 侧行为时：

- 新结论要么给出可复现的读取路径（注册表键、文件、sqlite 查询），要么标【推断】并做成可配置项；
- **不要发明 OfficeAce 的接口、字段名、区域划分或凭据位置。** 参考实现（loomy / trae）只对 DSH 侧机制有参考价值；
- 已知缺口（wincred 登录态、用量接口）在文档与代码注释里都写着「未实现」，不要为了让 README 好看而删掉这些说明；
- 本仓库不出现真实账号 id、token、余额或本机用户名。示例值一律脱敏成形状。

## 二、验证

```
npm run check     # typecheck + test + build，必须绿
```

- 测试是离线可判定的：路径推导、sqlite 只读解析、会话过期/脱敏、目录归一化、设置原子写、凭据优先级、上游错误分类、shim 鉴权与 SSE 透传、路由门禁与 CSRF。
- 涉及上游行为的改动，至少跑一次 `node lib/cli-doctor.js`；没有凭据时 `probe` 会以 3 退出，这是预期。
- 修 bug 先写一条会失败的测试，确认它失败，再修到通过。

## 三、工程约定

- 源码在 `src/*.ts`，`tsc` 直出 `lib/`；测试编译到 `out-test/`，由 `scripts/test.mjs` 单进程导入执行。
- 不引入 bundler、不加运行时依赖；`@deepseek-ai/*` 与 `@earendil-works/pi-ai` 是 peerDependencies，声明在 `types/peers.d.ts`。
- 插件只读写自己的设置命名空间与 `~/.dsh/dsh-connect-officeace.*.json`，不与其它插件共享状态。

## 四、发布

`prepack` 会跑完整 `check`。打包前确认 `files` 白名单里没有 `src/`、`out-test/`、`scripts/`。
